/*************************************************************
 * ChickSMS — ESP32 + SIM800L + MQTT (Hardened Version)
 * Partition: Huge APP (3MB no OTA) / 1MB SPIFFS (optional)
 * Keeps your functionality; improves stability & parsing.
 *************************************************************/

#include <WiFi.h>
#include <PubSubClient.h>
#include <HardwareSerial.h>
#include "esp_task_wdt.h"

// ---------------- WIFI SETTINGS ----------------
const char* ssid           = "ITP Coworking";
const char* password       = "1nnovation";

// ---------------- MQTT SETTINGS ----------------
const char* mqtt_server    = "95.217.15.58";
const int   mqtt_port      = 1883;
const char* mqtt_topic     = "test/topic";      // inbound control (phone|message)
const char* mqtt_username  = "";                // leave empty if no auth
const char* mqtt_password  = "";
const char* mqtt_client_id = "ESP32-ChickSMS-Client";

// ---------------- SIM800L SETTINGS -------------
HardwareSerial sim800(2);        // UART2
const int SIM800_RX = 16;        // ESP32 RX <- SIM800 TX
const int SIM800_TX = 17;        // ESP32 TX -> SIM800 RX
const int SIM800_BAUD = 9600;

// ---------------- TIMERS / INTERVALS -----------
unsigned long lastSMSCheck       = 0;
const unsigned long SMS_CHECK_INTERVAL = 10000;   // 10s

unsigned long lastSIMCheck       = 0;
const unsigned long SIM_CHECK_INTERVAL = 60000;   // 60s

unsigned long lastHeapCheck      = 0;
const unsigned long HEAP_CHECK_INTERVAL = 30000;  // 30s

unsigned long lastWDTFeed        = 0;
const unsigned long WDT_FEED_INTERVAL = 900;      // ~1s

// SMS send rate-limit
bool isProcessingSMS = false;
unsigned long lastSMSProcessTime = 0;
const unsigned long SMS_PROCESS_INTERVAL = 10000; // 10s

// ---------------- MQTT CLIENT ------------------
WiFiClient espClient;
PubSubClient client(espClient);

// ---------------- RESPONSE BUFFERS -------------
// Keep these modest to avoid memory spikes
static char  respBuf[512];     // general responses
static char  lineBuf[256];     // line reads

// ---------------- HELPERS (TIME) ---------------
static inline unsigned long nowMs() { return millis(); }

int mqtConnectFailureCount = 0;

// ---------------- SERIAL / AT HELPERS ----------

void feedWDT() {
  unsigned long t = nowMs();
  if (t - lastWDTFeed > WDT_FEED_INTERVAL) {
    lastWDTFeed = t;
    esp_task_wdt_reset();
    // yield() not strictly needed when WDT is fed here
  }
}

void simFlush(unsigned long ms = 30) {
  unsigned long tEnd = nowMs() + ms;
  while (nowMs() < tEnd) {
    while (sim800.available()) (void)sim800.read();
    delay(1);
  }
}

void safeDelay(unsigned long ms) {
  unsigned long tEnd = nowMs() + ms;
  while (nowMs() < tEnd) {
    feedWDT();
    delay(1);
  }
}

// read bytes until timeout or buffer full; returns length
size_t readBytesWithTimeout(char* buf, size_t maxLen, unsigned long timeoutMs) {
  size_t idx = 0;
  unsigned long tEnd = nowMs() + timeoutMs;
  while (nowMs() < tEnd && idx + 1 < maxLen) {
    while (sim800.available()) {
      buf[idx++] = (char)sim800.read();
      if (idx + 1 >= maxLen) break;
    }
    if (!sim800.available()) delay(1);
    feedWDT();
  }
  buf[idx] = '\0';
  return idx;
}

// waits for any of the tokens in 'needles' to appear in stream within timeout
// also collects into respBuf (capped). Returns index of matched needle or -1
int waitForAny(const char* needles[], int nNeedles, unsigned long timeoutMs, char* out, size_t outCap) {
  size_t idx = 0;
  unsigned long tEnd = nowMs() + timeoutMs;
  while (nowMs() < tEnd && idx + 1 < outCap) {
    while (sim800.available()) {
      char c = (char)sim800.read();
      out[idx++] = c;
      out[idx] = '\0';
      // check each token quickly (short tokens)
      for (int i = 0; i < nNeedles; i++) {
        if (strstr(out, needles[i]) != nullptr) {
          return i;
        }
      }
      if (idx + 1 >= outCap) break;
    }
    if (!sim800.available()) delay(1);
    feedWDT();
  }
  return -1;
}

bool waitForPrompt(unsigned long timeoutMs = 5000) {
  const char* needles[] = {">", "ERROR", "NO CARRIER", "BUSY"};
  simFlush(5);
  int got = waitForAny(needles, 4, timeoutMs, respBuf, sizeof(respBuf));
  // Success only if '>' arrived
  return (got == 0);
}

// Sends AT cmd + CRLF and (optionally) waits for OK/ERROR
// Returns true if "OK" seen (or "CMGS" if expectCMGS), false on ERROR or timeout
bool sendAT(const char* cmd, unsigned long waitMs = 2000, bool expectCMGS = false) {
  simFlush(3);
  sim800.println(cmd);
  const char* okNeedles[] = { "OK", "ERROR", "+CMS ERROR", "+CME ERROR", "+CMGS:" };
  int got = waitForAny(okNeedles, 5, waitMs, respBuf, sizeof(respBuf));

  if (got == -1) return false;
  if (expectCMGS) {
    // treat "+CMGS:" as success, even if OK not yet appended
    if (got == 4) return true;
  }
  // treat OK as success, errors as fail
  if (got == 0) return true;
  return false;
}

// Trim helpers for Arduino String (used sparingly)
String trimQuotes(const String& s) {
  int a = s.indexOf('\"');
  int b = s.lastIndexOf('\"');
  if (a >= 0 && b > a) return s.substring(a+1, b);
  return s;
}

// ---------------- WIFI / MQTT -------------------

void setup_wifi() {
  Serial.println();
  Serial.printf("Connecting to Wi-Fi: %s\n", ssid);
  WiFi.begin(ssid, password);
  unsigned long tEnd = nowMs() + 20000; // 20s
  while (WiFi.status() != WL_CONNECTED && nowMs() < tEnd) {
    delay(250);
    Serial.print(".");
    feedWDT();
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi-Fi connect timeout (continuing, will retry in loop)");
  }
}

void reportSMSStatus(const String& phone, const String& status, const String& errorMsg) {
  String statusMessage = phone + "|" + status;
  if (errorMsg.length() > 0) statusMessage += "|" + errorMsg;
  if (client.connected()) {
    client.publish("sms/status", statusMessage.c_str());
    if (status == "SENT") {
      Serial.printf("📊 STATUS REPORTED: ✅ %s - SENT\n", phone.c_str());
    } else if (status == "FAILED") {
      Serial.printf("📊 STATUS REPORTED: ❌ %s - FAILED (%s)\n", phone.c_str(), errorMsg.c_str());
    } else {
      Serial.printf("📊 STATUS REPORTED: %s\n", statusMessage.c_str());
    }
  } else {
    Serial.printf("⚠️  MQTT not connected, couldn't report status for %s\n", phone.c_str());
  }
}

void reportIncomingSMS(const String& phoneNumber, const String& message) {
  String payload = phoneNumber + "|" + message + "|" + String(millis());
  Serial.printf("Incoming SMS from: %s\nMessage: %s\n", phoneNumber.c_str(), message.c_str());
  if (client.connected()) {
    client.publish("sms/incoming", payload.c_str());
    Serial.println("Incoming SMS reported to server.");
  } else {
    Serial.println("MQTT not connected, couldn't report incoming SMS");
  }
}

void reconnect() {
  if (client.connected()) return;
  Serial.print("Attempting MQTT connection...");
  bool connected = false;
  if (strlen(mqtt_username) > 0 && strlen(mqtt_password) > 0) {
    connected = client.connect(mqtt_client_id, mqtt_username, mqtt_password);
    Serial.print(" with auth...");
  } else {
    connected = client.connect(mqtt_client_id);
    Serial.print(" without auth...");
  }

  if (connected) {
    Serial.println("connected");
    client.subscribe(mqtt_topic);
    Serial.println(String("Subscribed to: ") + mqtt_topic);
    mqtConnectFailureCount = 0; // Reset failure counter on successful connection
  } else {
    Serial.print("failed, rc=");
    Serial.print(client.state());
    Serial.println(" (will retry)");
  }
}

// ---------------- SIM / NETWORK CHECKS ---------

bool checkSIM800Alive() {
  return sendAT("AT", 800);
}

bool checkSIMReady() {
  if (!sendAT("AT+CPIN?", 1500)) return false;
  // respBuf contains last response
  return strstr(respBuf, "READY") != nullptr;
}

bool checkNetworkRegistered() {
  if (!sendAT("AT+CREG?", 1500)) return false;
  // Expect +CREG: n,stat  where stat=1 (home) or 5 (roaming)
  if (strstr(respBuf, "+CREG:") == nullptr) return false;
  if (strstr(respBuf, ",1") || strstr(respBuf, ", 1")) return true;
  if (strstr(respBuf, ",5") || strstr(respBuf, ", 5")) return true;
  return false;
}

void getOperatorIfAny() {
  if (sendAT("AT+COPS?", 2000)) {
    Serial.printf("Operator Response: %s\n", respBuf);
  }
}

void getSignalIfAny() {
  if (sendAT("AT+CSQ", 1200)) {
    Serial.printf("Signal Response: %s\n", respBuf);
  }
}

bool performFullSIMCheck() {
  Serial.println("\n=== SIM800L Comprehensive Check ===");
  if (!checkSIM800Alive()) {
    Serial.println("❌ FAILED: SIM800L not responding to AT");
    return false;
  }
  if (!checkSIMReady()) {
    Serial.println("❌ FAILED: SIM not READY");
    return false;
  }
  // attempt up to 10 times for registration
  for (int i = 0; i < 10; i++) {
    if (checkNetworkRegistered()) break;
    Serial.printf("Waiting for network registration... (%d/10)\n", i+1);
    safeDelay(3000);
  }
  if (!checkNetworkRegistered()) {
    Serial.println("❌ FAILED: Not registered to network");
    return false;
  }
  getOperatorIfAny();
  getSignalIfAny();
  Serial.println("✅ SUCCESS: SIM800L is fully operational");
  Serial.println("====================================\n");
  return true;
}

void setupSMSMode() {
  Serial.println("Setting up SMS mode...");
  sendAT("AT+CMGF=1", 1500);                   // text mode
  sendAT("AT+CPMS=\"SM\",\"SM\",\"SM\"", 1500);// SIM storage
  sendAT("AT+CNMI=1,2,0,0,0", 1500);           // new SMS indications
  Serial.println("SMS mode configured");
}

// ---------------- SMS SENDING -------------------

bool sendSMSImmediate(const String& phone, const String& text) {
  isProcessingSMS = true; // set early; always clear on exit

  auto finallyClear = []() {
    isProcessingSMS = false;
  };

  // basic memory check
  uint32_t freeHeap = ESP.getFreeHeap();
  if (freeHeap < 15000) {
    Serial.printf("❌ INSUFFICIENT MEMORY: %lu bytes\n", (unsigned long)freeHeap);
    reportSMSStatus(phone, "FAILED", "Low memory");
    finallyClear();
    return false;
  }

  if (phone.length() > 20 || text.length() > 160) {
    Serial.printf("❌ STRING TOO LONG - Phone: %d, Text: %d\n", phone.length(), text.length());
    reportSMSStatus(phone, "FAILED", "Message too long");
    finallyClear();
    return false;
  }

  Serial.printf("📤 SENDING SMS to: %s\n📝 \"%s\"\n💾 Free heap: %lu bytes\n",
                phone.c_str(), text.c_str(), (unsigned long)freeHeap);

  reportSMSStatus(phone, "SENDING", "");

  // Robust pre-checks
  bool alive = false;
  for (int r = 0; r < 3; r++) {
    if (checkSIM800Alive()) { alive = true; break; }
    Serial.printf("⚠️  SIM800L check failed, retry %d/3\n", r+1);
    safeDelay(400);
  }
  if (!alive) {
    reportSMSStatus(phone, "FAILED", "SIM800L no AT");
    finallyClear();
    return false;
  }

  if (!checkSIMReady()) {
    reportSMSStatus(phone, "FAILED", "SIM not ready");
    finallyClear();
    return false;
  }
  if (!checkNetworkRegistered()) {
    reportSMSStatus(phone, "FAILED", "Not registered");
    finallyClear();
    return false;
  }

  // Set text mode
  if (!sendAT("AT+CMGF=1", 1500)) {
    reportSMSStatus(phone, "FAILED", "CMGF fail");
    finallyClear();
    return false;
  }

  // AT+CMGS
  {
    char cmd[48];
    snprintf(cmd, sizeof(cmd), "AT+CMGS=\"%s\"", phone.c_str());
    simFlush(3);
    sim800.println(cmd);
    if (!waitForPrompt(5000)) {
      reportSMSStatus(phone, "FAILED", "No '>' prompt");
      finallyClear();
      return false;
    }
  }

  // send content and Ctrl+Z
  sim800.print(text);
  sim800.print("\r");   // newline
  safeDelay(200);
  sim800.write(26);     // Ctrl+Z
  // Wait for +CMGS/OK/ERROR (SIM can take time)
  const char* needles[] = { "+CMGS:", "OK", "ERROR", "+CMS ERROR" };
  int got = waitForAny(needles, 4, 15000, respBuf, sizeof(respBuf));
  Serial.printf("SIM800L response: %s\n", respBuf);

  if (got == 0 || got == 1) { // +CMGS or OK
    reportSMSStatus(phone, "SENT", "");
    finallyClear();
    return true;
  }

  String err = "Unknown";
  if (got == 2) err = "ERROR";
  else if (got == 3) {
    // try to extract code
    char* p = strstr(respBuf, "+CMS ERROR:");
    if (p) {
      p += 11;
      while (*p == ' ') p++;
      String code = "";
      while (*p && *p != '\r' && *p != '\n') { code += *p; p++; }
      err = "CMS " + code;
    } else err = "CMS ERROR";
  }
  reportSMSStatus(phone, "FAILED", err);
  finallyClear();
  return false;
}

bool sendSMS(const String& phone, const String& text) {
  if (isProcessingSMS) {
    Serial.printf("⚠️  SMS already in progress, ignoring: %s\n", phone.c_str());
    reportSMSStatus(phone, "FAILED", "Busy");
    return false;
  }
  if (nowMs() - lastSMSProcessTime < SMS_PROCESS_INTERVAL) {
    unsigned long waitTime = SMS_PROCESS_INTERVAL - (nowMs() - lastSMSProcessTime);
    Serial.printf("⚠️  Rate limited, wait %lu ms for: %s\n", waitTime, phone.c_str());
    reportSMSStatus(phone, "FAILED", "Rate limited");
    return false;
  }
  lastSMSProcessTime = nowMs();
  return sendSMSImmediate(phone, text);
}

// ---------------- INCOMING SMS ------------------

void deleteSMS(const String& index) {
  char cmd[24];
  snprintf(cmd, sizeof(cmd), "AT+CMGD=%s", index.c_str());
  sendAT(cmd, 1000);
  Serial.printf("Deleted SMS at index: %s\n", index.c_str());
}

// Parse one +CMGR or +CMGL item
void processSpecificSMS(const String& smsContent, const String& smsIndex) {
  Serial.println("🔍 Processing specific SMS...");
  if (smsContent.indexOf("+CMGR:") == -1 && smsContent.indexOf("+CMGL:") == -1) {
    Serial.println("❌ Invalid SMS content");
    return;
  }

  // extract phone number "..."
  int q1 = smsContent.indexOf("\"");
  int q2 = smsContent.indexOf("\"", q1 + 1);
  if (q1 == -1 || q2 == -1) {
    Serial.println("❌ Could not extract phone number");
    return;
  }
  String phoneNumber = smsContent.substring(q1 + 1, q2);

  // message is after next two line breaks from header line
  int o = smsContent.indexOf("\n", q2);
  if (o == -1) { Serial.println("❌ Could not find message start"); return; }
  o = smsContent.indexOf("\n", o + 1);
  if (o == -1) { Serial.println("❌ Could not find message start"); return; }
  String message = smsContent.substring(o + 1);
  message.trim();
  message.replace("\"", "");

  if (phoneNumber.length() && message.length()) {
    reportIncomingSMS(phoneNumber, message);
    if (smsIndex.length()) deleteSMS(smsIndex);
  }
}

// Process list from AT+CMGL="REC UNREAD" result
void processSMSList(const String& smsData) {
  Serial.println("📋 Processing SMS list...");
  int startIndex = 0;
  int smsCount = 0;

  while (true) {
    int cmglIndex = smsData.indexOf("+CMGL:", startIndex);
    if (cmglIndex == -1) break;
    smsCount++;

    // index
    int comma1 = smsData.indexOf(",", cmglIndex);
    String smsIndex = smsData.substring(cmglIndex + 7, comma1);
    smsIndex.trim();

    // phone
    int q1 = smsData.indexOf("\"", comma1 + 1);
    int q2 = smsData.indexOf("\"", q1 + 1);
    if (q1 == -1 || q2 == -1) break;
    String phoneNumber = smsData.substring(q1 + 1, q2);

    // message content
    int lineEnd = smsData.indexOf("\n", q2);
    int msgStart = smsData.indexOf("\n", lineEnd + 1);
    int msgEnd   = smsData.indexOf("\n", msgStart + 1);
    if (msgStart == -1) break;
    if (msgEnd == -1) msgEnd = smsData.length();
    String message = smsData.substring(msgStart + 1, msgEnd);
    message.trim();
    message.replace("\"", "");

    if (phoneNumber.length() && message.length()) {
      reportIncomingSMS(phoneNumber, message);
      deleteSMS(smsIndex);
    }
    startIndex = msgEnd;
  }

  if (smsCount == 0) Serial.println("ℹ️  No SMS found in response");
  else Serial.printf("✅ Processed %d SMS messages\n", smsCount);
}

// Poll unread using CMGL (backup)
void checkForIncomingSMS() {
  if (nowMs() - lastSMSCheck < SMS_CHECK_INTERVAL) return;
  lastSMSCheck = nowMs();

  simFlush(3);
  sim800.println("AT+CMGL=\"REC UNREAD\"");
  safeDelay(2000);
  readBytesWithTimeout(respBuf, sizeof(respBuf), 1000);
  String response = String(respBuf);

  if (response.indexOf("+CMGL:") != -1) {
    Serial.println("📨 Found unread SMS, processing...");
    processSMSList(response);
  } else {
    Serial.println("… No unread SMS.");
  }
}

// Real-time +CNMI notifications
void checkSMSNotifications() {
  // Non-blocking peek of UART
  if (!sim800.available()) return;

  String notification = "";
  unsigned long tEnd = nowMs() + 100; // short window to collect burst
  while (nowMs() < tEnd && sim800.available()) {
    notification += (char)sim800.read();
    delay(1);
  }
  if (notification.length() == 0) return;

  Serial.println("📬 SIM800L Notification:");
  Serial.println(notification);

  // +CMTI: "SM", index
  int p = notification.indexOf("+CMTI:");
  if (p != -1) {
    int comma = notification.indexOf(",", p);
    if (comma != -1) {
      String smsIndex = notification.substring(comma + 1);
      smsIndex.trim();
      Serial.println("📍 Reading SMS at index: " + smsIndex);

      char cmd[24];
      snprintf(cmd, sizeof(cmd), "AT+CMGR=%s", smsIndex.c_str());
      if (sendAT(cmd, 2000)) {
        String smsContent = String(respBuf);
        processSpecificSMS(smsContent, smsIndex);
      }
    }
  }
}

// ---------------- PERIODIC HEALTH ---------------

void periodicSIMCheck() {
  if (nowMs() - lastSIMCheck < SIM_CHECK_INTERVAL) return;
  lastSIMCheck = nowMs();

  if (!checkSIMReady()) {
    Serial.printf("❌ SIM card not ready: %s\n", respBuf);
  }
  if (!checkNetworkRegistered()) {
    Serial.printf("❌ Not registered: %s\n", respBuf);
  }
}

void monitorSystemHealth() {
  if (nowMs() - lastHeapCheck > HEAP_CHECK_INTERVAL) {
    lastHeapCheck = nowMs();
    uint32_t freeHeap = ESP.getFreeHeap();
    if (freeHeap < 15000) {
      Serial.printf("⚠️  LOW MEMORY WARNING: %lu bytes free\n", (unsigned long)freeHeap);
      if (!isProcessingSMS) safeDelay(50);
    }
  }
  feedWDT();
}

// ---------------- MQTT CALLBACK -----------------

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  msg.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.println("📨 MQTT MESSAGE RECEIVED: " + msg);

  int sep = msg.indexOf('|');
  if (sep == -1) {
    Serial.println("❌ INVALID MESSAGE FORMAT. Use phone|message");
    return;
  }
  String phone = msg.substring(0, sep);
  String text  = msg.substring(sep + 1);

  Serial.println("📥 SMS REQUEST for: " + phone);
  Serial.println("📝 Message: \"" + text + "\"");

  bool success = sendSMS(phone, text);
  if (success) Serial.println("✅ SMS ACCEPTED FOR SENDING");
  else         Serial.println("❌ SMS REJECTED (rate limited or busy)");
}

// ---------------- SETUP / LOOP ------------------

void setup() {
  Serial.begin(115200);
  sim800.begin(SIM800_BAUD, SERIAL_8N1, SIM800_RX, SIM800_TX);
  Serial.println("\nChickSMS ESP32 Client Starting...");

  // WDT: 8 seconds timeout; panic=true (will backtrace/reboot instead of hang)
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = 8000,      // 8 seconds
    .trigger_panic = true    // reset on timeout
  };
  esp_task_wdt_init(&wdt_config);  // pass pointer to struct
  esp_task_wdt_add(NULL);          // add current task (loop)


  safeDelay(1500);
  Serial.println("Initializing SIM800L...");

  if (performFullSIMCheck()) {
    setupSMSMode();
  } else {
    Serial.println("⚠️  WARNING: SIM800L setup failed, continuing with MQTT only.");
  }

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);

  Serial.println("Setup complete. Ready for MQTT commands and SMS monitoring.");
}

void loop() {
  monitorSystemHealth();

  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWiFiTry = 0;
    if (nowMs() - lastWiFiTry > 5000) {
      lastWiFiTry = nowMs();
      WiFi.reconnect();
    }
  }

  if (!client.connected()) {
    reconnect();
    mqtConnectFailureCount++;
    if(mqtConnectFailureCount > 10) {
      Serial.println("⚠️  Too many MQTT connection failures, restarting ESP32...");
      delay(1000); // Give time for serial message to be sent
      ESP.restart();
    }
  }
  client.loop();

  

  checkSMSNotifications();  // immediate CNMI
  periodicSIMCheck();       // 60s health
  checkForIncomingSMS();    // 10s backup poll

  delay(120);               // modest pacing
}
