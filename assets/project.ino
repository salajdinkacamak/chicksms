#include <WiFi.h>
#include <PubSubClient.h>
#include <HardwareSerial.h>

// --- WIFI SETTINGS ---
const char* ssid = "Salajdin";
const char* password = "33337777";

// --- MQTT SETTINGS ---
const char* mqtt_server = "95.217.15.58"; // your PC Mosquitto IP
const int mqtt_port = 1883;
const char* mqtt_topic = "test/topic";
const char* mqtt_username = ""; // Leave empty if no auth required
const char* mqtt_password = ""; // Leave empty if no auth required
const char* mqtt_client_id = "ESP32-ChickSMS-Client";

// --- SIM800L SETTINGS ---
HardwareSerial sim800(2); // use UART2 (RX=16, TX=17)
const int SIM800_BAUD = 9600;

// --- SMS READING VARIABLES ---
unsigned long lastSMSCheck = 0;
const unsigned long SMS_CHECK_INTERVAL = 10000; // Check for new SMS every 10 seconds

// --- MQTT CLIENT ---
WiFiClient espClient;
PubSubClient client(espClient);

// --- FUNCTIONS ---

void setup_wifi() {
  delay(100);
  Serial.println();
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Wi-Fi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

bool checkSIM800Status() {
  sim800.println("AT");
  delay(1000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  if (response.indexOf("OK") != -1) {
    Serial.println("SIM800L is ready");
    return true;
  } else {
    Serial.println("SIM800L not responding");
    return false;
  }
}

bool checkSIMCard() {
  Serial.println("Checking SIM card status...");
  
  // Check if SIM card is inserted
  sim800.println("AT+CPIN?");
  delay(2000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  Serial.println("SIM Status Response: " + response);
  
  if (response.indexOf("READY") != -1) {
    Serial.println("✅ SIM card is ready");
    return true;
  } else if (response.indexOf("SIM PIN") != -1) {
    Serial.println("❌ SIM card requires PIN");
    return false;
  } else if (response.indexOf("SIM PUK") != -1) {
    Serial.println("❌ SIM card is PUK locked");
    return false;
  } else if (response.indexOf("NOT INSERTED") != -1) {
    Serial.println("❌ SIM card not inserted");
    return false;
  } else {
    Serial.println("❌ Unknown SIM card status");
    return false;
  }
}

bool checkNetworkRegistration() {
  Serial.println("Checking network registration...");
  
  // Check network registration status
  sim800.println("AT+CREG?");
  delay(2000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  Serial.println("Network Registration Response: " + response);
  
  // Parse +CREG response
  // +CREG: n,stat where stat: 0=not searching, 1=registered(home), 2=searching, 3=denied, 5=registered(roaming)
  if (response.indexOf("+CREG: 0,1") != -1) {
    Serial.println("✅ Registered on home network");
    return true;
  } else if (response.indexOf("+CREG: 0,5") != -1) {
    Serial.println("✅ Registered on roaming network");
    return true;
  } else if (response.indexOf("+CREG: 0,2") != -1) {
    Serial.println("🔍 Searching for network...");
    return false;
  } else if (response.indexOf("+CREG: 0,3") != -1) {
    Serial.println("❌ Network registration denied");
    return false;
  } else if (response.indexOf("+CREG: 0,0") != -1) {
    Serial.println("❌ Not searching for network");
    return false;
  } else {
    Serial.println("❌ Unknown network registration status");
    return false;
  }
}

String getNetworkOperator() {
  Serial.println("Getting network operator info...");
  
  // Get current operator
  sim800.println("AT+COPS?");
  delay(2000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  Serial.println("Operator Response: " + response);
  
  // Extract operator name from +COPS: 0,0,"OperatorName" format
  int startQuote = response.indexOf("\"");
  if (startQuote != -1) {
    int endQuote = response.indexOf("\"", startQuote + 1);
    if (endQuote != -1) {
      String operator_name = response.substring(startQuote + 1, endQuote);
      Serial.println("📡 Network Operator: " + operator_name);
      return operator_name;
    }
  }
  
  Serial.println("❌ Could not get operator info");
  return "Unknown";
}

String getSignalStrength() {
  Serial.println("Checking signal strength...");
  
  // Get signal quality
  sim800.println("AT+CSQ");
  delay(1000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  Serial.println("Signal Response: " + response);
  
  // Parse +CSQ: rssi,ber response
  int csqIndex = response.indexOf("+CSQ: ");
  if (csqIndex != -1) {
    int commaIndex = response.indexOf(",", csqIndex);
    if (commaIndex != -1) {
      String rssiStr = response.substring(csqIndex + 6, commaIndex);
      int rssi = rssiStr.toInt();
      
      String signalQuality;
      if (rssi == 99) {
        signalQuality = "No signal";
      } else if (rssi >= 20) {
        signalQuality = "Excellent";
      } else if (rssi >= 15) {
        signalQuality = "Good";
      } else if (rssi >= 10) {
        signalQuality = "Fair";
      } else if (rssi >= 5) {
        signalQuality = "Poor";
      } else {
        signalQuality = "Very Poor";
      }
      
      String result = signalQuality + " (RSSI: " + rssi + ")";
      Serial.println("📶 Signal Strength: " + result);
      return result;
    }
  }
  
  Serial.println("❌ Could not get signal strength");
  return "Unknown";
}

bool performFullSIMCheck() {
  Serial.println("\n=== SIM800L Comprehensive Check ===");
  
  // Step 1: Basic AT command
  if (!checkSIM800Status()) {
    Serial.println("❌ FAILED: SIM800L not responding to AT commands");
    return false;
  }
  
  // Step 2: SIM card check
  if (!checkSIMCard()) {
    Serial.println("❌ FAILED: SIM card issue");
    return false;
  }
  
  // Step 3: Network registration
  int attempts = 0;
  while (attempts < 10) {
    if (checkNetworkRegistration()) {
      break;
    }
    attempts++;
    Serial.println("Waiting for network registration... (" + String(attempts) + "/10)");
    delay(3000);
  }
  
  if (attempts >= 10) {
    Serial.println("❌ FAILED: Could not register on network");
    return false;
  }
  
  // Step 4: Get network info
  getNetworkOperator();
  getSignalStrength();
  
  Serial.println("✅ SUCCESS: SIM800L is fully operational");
  Serial.println("====================================\n");
  
  return true;
}

void setupSMSMode() {
  Serial.println("Setting up SMS mode...");
  
  // Set SMS to text mode
  sim800.println("AT+CMGF=1");
  delay(500);
  
  // Set SMS storage to SIM card
  sim800.println("AT+CPMS=\"SM\",\"SM\",\"SM\"");
  delay(500);
  
  // Enable SMS notifications
  sim800.println("AT+CNMI=1,2,0,0,0");
  delay(500);
  
  Serial.println("SMS mode configured");
}

// Manual SMS check function for testing
void manualSMSCheck() {
  Serial.println("\n=== Manual SMS Check ===");
  
  // Check all SMS (read and unread)
  sim800.println("AT+CMGL=\"ALL\"");
  delay(3000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  Serial.println("All SMS Response: " + response);
  
  if (response.indexOf("+CMGL:") != -1) {
    Serial.println("📨 Found SMS messages:");
    processSMSList(response);
  } else {
    Serial.println("📭 No SMS messages found");
  }
  
  Serial.println("=== End Manual Check ===\n");
}

// Alternative method to check for new SMS using +CNMI
void checkSMSNotifications() {
  // Check if there's any immediate data from SIM800L (SMS notifications)
  if (sim800.available()) {
    String notification = "";
    while (sim800.available()) {
      notification += (char)sim800.read();
    }
    
    Serial.println("📬 SIM800L Notification: " + notification);
    
    // Check if it's an SMS notification (+CMTI: "SM",index)
    if (notification.indexOf("+CMTI:") != -1) {
      Serial.println("📨 New SMS notification received!");
      
      // Extract the SMS index
      int indexStart = notification.lastIndexOf(",");
      if (indexStart != -1) {
        String smsIndex = notification.substring(indexStart + 1);
        smsIndex.trim();
        Serial.println("📍 Reading SMS at index: " + smsIndex);
        
        // Read the specific SMS
        sim800.println("AT+CMGR=" + smsIndex);
        delay(2000);
        
        String smsContent = "";
        while (sim800.available()) {
          smsContent += (char)sim800.read();
        }
        
        Serial.println("📄 SMS Content: " + smsContent);
        processSpecificSMS(smsContent, smsIndex);
      }
    }
  }
}

// Process a specific SMS read by AT+CMGR
void processSpecificSMS(String smsContent, String smsIndex) {
  Serial.println("🔍 Processing specific SMS...");
  
  if (smsContent.indexOf("+CMGR:") == -1) {
    Serial.println("❌ Invalid SMS content");
    return;
  }
  
  // Extract phone number
  int quote1 = smsContent.indexOf("\"");
  int quote2 = smsContent.indexOf("\"", quote1 + 1);
  
  if (quote1 == -1 || quote2 == -1) {
    Serial.println("❌ Could not extract phone number");
    return;
  }
  
  String phoneNumber = smsContent.substring(quote1 + 1, quote2);
  
  // Extract message (after the timestamp line)
  int messageStart = smsContent.indexOf("\n");
  messageStart = smsContent.indexOf("\n", messageStart + 1);
  
  if (messageStart == -1) {
    Serial.println("❌ Could not find message content");
    return;
  }
  
  String message = smsContent.substring(messageStart + 1);
  message.trim();
  message.replace("\"", "");
  
  Serial.println("📞 From: " + phoneNumber);
  Serial.println("💬 Message: " + message);
  
  if (phoneNumber.length() > 0 && message.length() > 0) {
    reportIncomingSMS(phoneNumber, message);
    deleteSMS(smsIndex);
  }
}

void checkForIncomingSMS() {
  // Check if it's time to check for SMS
  if (millis() - lastSMSCheck < SMS_CHECK_INTERVAL) {
    return;
  }
  lastSMSCheck = millis();
  
  Serial.println("🔍 Checking for incoming SMS...");
  
  // List all unread SMS
  sim800.println("AT+CMGL=\"REC UNREAD\"");
  delay(2000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  Serial.println("SMS Check Response: " + response);
  
  if (response.length() > 0 && response.indexOf("+CMGL:") != -1) {
    Serial.println("📨 Found unread SMS, processing...");
    processSMSList(response);
  } else if (response.length() > 0) {
    Serial.println("ℹ️  No unread SMS found");
  } else {
    Serial.println("⚠️  No response from SIM800L for SMS check");
  }
}

void processSMSList(String smsData) {
  Serial.println("📋 Processing SMS data: " + smsData);
  int startIndex = 0;
  int smsCount = 0;
  
  while (true) {
    int cmglIndex = smsData.indexOf("+CMGL:", startIndex);
    if (cmglIndex == -1) break;
    
    smsCount++;
    Serial.println("📱 Processing SMS #" + String(smsCount));
    
    // Extract SMS index
    int commaIndex1 = smsData.indexOf(",", cmglIndex);
    if (commaIndex1 == -1) {
      Serial.println("❌ Could not find first comma in SMS data");
      break;
    }
    
    String smsIndex = smsData.substring(cmglIndex + 7, commaIndex1);
    smsIndex.trim();
    Serial.println("📍 SMS Index: " + smsIndex);
    
    // Extract phone number (between quotes)
    int quote1 = smsData.indexOf("\"", commaIndex1 + 1);
    int quote2 = smsData.indexOf("\"", quote1 + 1);
    if (quote1 == -1 || quote2 == -1) {
      Serial.println("❌ Could not find phone number quotes");
      break;
    }
    
    String phoneNumber = smsData.substring(quote1 + 1, quote2);
    Serial.println("📞 Phone Number: " + phoneNumber);
    
    // Find the message content (after the date line)
    int dateEnd = smsData.indexOf("\n", quote2);
    int messageStart = smsData.indexOf("\n", dateEnd + 1);
    int messageEnd = smsData.indexOf("\n", messageStart + 1);
    
    if (messageStart == -1) {
      Serial.println("❌ Could not find message start");
      break;
    }
    if (messageEnd == -1) messageEnd = smsData.length();
    
    String message = smsData.substring(messageStart + 1, messageEnd);
    message.trim();
    
    // Remove any remaining quotes or special characters
    message.replace("\"", "");
    
    Serial.println("💬 Message Content: " + message);
    
    if (phoneNumber.length() > 0 && message.length() > 0) {
      Serial.println("✅ Valid SMS found, reporting and deleting...");
      reportIncomingSMS(phoneNumber, message);
      deleteSMS(smsIndex);
    } else {
      Serial.println("❌ Invalid SMS data - phone: " + phoneNumber + ", message: " + message);
    }
    
    startIndex = messageEnd;
  }
  
  if (smsCount == 0) {
    Serial.println("ℹ️  No SMS found in response");
  } else {
    Serial.println("✅ Processed " + String(smsCount) + " SMS messages");
  }
}

void reportIncomingSMS(String phoneNumber, String message) {
  Serial.println("Incoming SMS from: " + phoneNumber);
  Serial.println("Message: " + message);
  
  // Report to server via MQTT
  // Expected format: phoneNumber|message|timestamp
  String timestamp = String(millis()); // Simple timestamp
  String incomingMessage = phoneNumber + "|" + message + "|" + timestamp;
  
  if (client.connected()) {
    client.publish("sms/incoming", incomingMessage.c_str());
    Serial.println("Incoming SMS reported to server: " + incomingMessage);
  } else {
    Serial.println("MQTT not connected, couldn't report incoming SMS");
  }
}

void deleteSMS(String index) {
  // Delete the SMS after processing
  sim800.println("AT+CMGD=" + index);
  delay(500);
  Serial.println("Deleted SMS at index: " + index);
}

bool sendSMS(String phone, String text) {
  Serial.println("Sending SMS to: " + phone);
  
  // Enhanced pre-checks before sending SMS
  Serial.println("Performing pre-send checks...");
  
  // Check if SIM800L is responding
  if (!checkSIM800Status()) {
    reportSMSStatus(phone, "FAILED", "SIM800L not responding");
    return false;
  }
  
  // Quick check if SIM is still ready
  sim800.println("AT+CPIN?");
  delay(1000);
  String simResponse = "";
  while (sim800.available()) {
    simResponse += (char)sim800.read();
  }
  
  if (simResponse.indexOf("READY") == -1) {
    reportSMSStatus(phone, "FAILED", "SIM card not ready");
    return false;
  }
  
  // Quick network check
  sim800.println("AT+CREG?");
  delay(1000);
  String networkResponse = "";
  while (sim800.available()) {
    networkResponse += (char)sim800.read();
  }
  
  if (networkResponse.indexOf("+CREG: 0,1") == -1 && networkResponse.indexOf("+CREG: 0,5") == -1) {
    reportSMSStatus(phone, "FAILED", "Not registered on network");
    return false;
  }
  
  Serial.println("✅ Pre-checks passed, sending SMS...");
  
  // Set text mode
  sim800.println("AT+CMGF=1");
  delay(500);
  
  // Check response
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  if (response.indexOf("OK") == -1) {
    reportSMSStatus(phone, "FAILED", "Failed to set text mode");
    return false;
  }
  
  // Send SMS command
  sim800.print("AT+CMGS=\"");
  sim800.print(phone);
  sim800.println("\"");
  delay(500);
  
  // Send message content
  sim800.println(text);
  delay(500);
  
  // Send Ctrl+Z to finish
  sim800.write(26);
  delay(5000);      // wait for response

  response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }

  Serial.println("SIM800L response: " + response);

  // Report status back to server via MQTT
  if (response.indexOf("OK") != -1 || response.indexOf("+CMGS:") != -1) {
    Serial.println("SMS sent successfully!");
    reportSMSStatus(phone, "SENT", "");
    return true;
  } else {
    Serial.println("Failed to send SMS.");
    String errorMsg = "Unknown Error";
    
    if (response.indexOf("ERROR") != -1) {
      errorMsg = "AT Command Error";
    } else if (response.indexOf("NO CARRIER") != -1) {
      errorMsg = "No Network Connection";
    } else if (response.indexOf("CMS ERROR") != -1) {
      // Extract CMS error code if available
      int cmsIndex = response.indexOf("CMS ERROR:");
      if (cmsIndex != -1) {
        String errorCode = response.substring(cmsIndex + 10, cmsIndex + 13);
        errorMsg = "CMS ERROR " + errorCode;
      } else {
        errorMsg = "SMS Service Error";
      }
    } else if (response.indexOf("NO DIALTONE") != -1) {
      errorMsg = "No Signal";
    } else if (response.length() == 0) {
      errorMsg = "No Response from SIM800L";
    }
    
    reportSMSStatus(phone, "FAILED", errorMsg);
    return false;
  }
}

void reportSMSStatus(String phone, String status, String errorMsg) {
  // Expected format: phoneNumber|status|error
  String statusMessage = phone + "|" + status;
  if (errorMsg.length() > 0) {
    statusMessage += "|" + errorMsg;
  }
  
  if (client.connected()) {
    client.publish("sms/status", statusMessage.c_str());
    Serial.println("Status reported: " + statusMessage);
  } else {
    Serial.println("MQTT not connected, couldn't report status");
  }
}

// Periodic SIM status monitoring
unsigned long lastSIMCheck = 0;
const unsigned long SIM_CHECK_INTERVAL = 60000; // Check SIM status every 60 seconds

void periodicSIMCheck() {
  if (millis() - lastSIMCheck < SIM_CHECK_INTERVAL) {
    return;
  }
  lastSIMCheck = millis();
  
  Serial.println("\n--- Periodic SIM Status Check ---");
  
  // Quick SIM card check
  sim800.println("AT+CPIN?");
  delay(1000);
  String simResponse = "";
  while (sim800.available()) {
    simResponse += (char)sim800.read();
  }
  
  if (simResponse.indexOf("READY") != -1) {
    Serial.println("✅ SIM card: Ready");
  } else {
    Serial.println("❌ SIM card: Not ready - " + simResponse);
    return;
  }
  
  // Quick network check
  sim800.println("AT+CREG?");
  delay(1000);
  String networkResponse = "";
  while (sim800.available()) {
    networkResponse += (char)sim800.read();
  }
  
  if (networkResponse.indexOf("+CREG: 0,1") != -1) {
    Serial.println("✅ Network: Registered (Home)");
  } else if (networkResponse.indexOf("+CREG: 0,5") != -1) {
    Serial.println("✅ Network: Registered (Roaming)");
  } else {
    Serial.println("❌ Network: Not registered - " + networkResponse);
  }
  
  // Quick signal check
  getSignalStrength();
  
  Serial.println("--- End SIM Status Check ---\n");
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  Serial.println("Message received: " + msg);

  // Expected format: phone|message
  int sep = msg.indexOf('|');
  if (sep != -1) {
    String phone = msg.substring(0, sep);
    String text = msg.substring(sep + 1);
    
    Serial.println("Attempting to send SMS to: " + phone);
    bool success = sendSMS(phone, text);
    
    if (success) {
      Serial.println("SMS delivery completed successfully");
    } else {
      Serial.println("SMS delivery failed");
    }
  } else {
    Serial.println("Invalid message format. Use phone|message");
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    bool connected = false;
    
    // Connect with or without authentication
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
      Serial.println("Subscribed to: " + String(mqtt_topic));
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  sim800.begin(SIM800_BAUD, SERIAL_8N1, 16, 17); // RX, TX

  Serial.println("ChickSMS ESP32 Client Starting...");
  
  // Initialize SIM800L with comprehensive check
  delay(2000);
  Serial.println("Initializing SIM800L...");
  
  // Perform full SIM check including card status and network registration
  if (performFullSIMCheck()) {
    // Setup SMS reading mode only if SIM is ready
    setupSMSMode();
  } else {
    Serial.println("⚠️  WARNING: SIM800L setup failed, but continuing with MQTT...");
    Serial.println("SMS functionality will not work until SIM issues are resolved.");
  }

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  
  Serial.println("Setup complete. Ready to receive SMS commands via MQTT and monitor incoming SMS.");
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  
  // Check for immediate SMS notifications (real-time)
  checkSMSNotifications();
  
  // Periodic SIM status monitoring
  periodicSIMCheck();
  
  // Check for incoming SMS periodically (backup method)
  checkForIncomingSMS();
  
  // Small delay to prevent overwhelming the system
  delay(100);
}
