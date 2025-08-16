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

void checkForIncomingSMS() {
  // Check if it's time to check for SMS
  if (millis() - lastSMSCheck < SMS_CHECK_INTERVAL) {
    return;
  }
  lastSMSCheck = millis();
  
  // List all unread SMS
  sim800.println("AT+CMGL=\"REC UNREAD\"");
  delay(2000);
  
  String response = "";
  while (sim800.available()) {
    response += (char)sim800.read();
  }
  
  if (response.length() > 0 && response.indexOf("+CMGL:") != -1) {
    processSMSList(response);
  }
}

void processSMSList(String smsData) {
  int startIndex = 0;
  
  while (true) {
    int cmglIndex = smsData.indexOf("+CMGL:", startIndex);
    if (cmglIndex == -1) break;
    
    // Extract SMS index
    int commaIndex1 = smsData.indexOf(",", cmglIndex);
    if (commaIndex1 == -1) break;
    
    String smsIndex = smsData.substring(cmglIndex + 7, commaIndex1);
    smsIndex.trim();
    
    // Extract phone number (between quotes)
    int quote1 = smsData.indexOf("\"", commaIndex1 + 1);
    int quote2 = smsData.indexOf("\"", quote1 + 1);
    if (quote1 == -1 || quote2 == -1) break;
    
    String phoneNumber = smsData.substring(quote1 + 1, quote2);
    
    // Find the message content (after the date line)
    int dateEnd = smsData.indexOf("\n", quote2);
    int messageStart = smsData.indexOf("\n", dateEnd + 1);
    int messageEnd = smsData.indexOf("\n", messageStart + 1);
    
    if (messageStart == -1) break;
    if (messageEnd == -1) messageEnd = smsData.length();
    
    String message = smsData.substring(messageStart + 1, messageEnd);
    message.trim();
    
    // Remove any remaining quotes or special characters
    message.replace("\"", "");
    
    if (phoneNumber.length() > 0 && message.length() > 0) {
      reportIncomingSMS(phoneNumber, message);
      deleteSMS(smsIndex);
    }
    
    startIndex = messageEnd;
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
  
  // Check if SIM800L is responding
  if (!checkSIM800Status()) {
    reportSMSStatus(phone, "FAILED", "SIM800L not responding");
    return false;
  }
  
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
  
  // Initialize SIM800L
  delay(2000);
  Serial.println("Initializing SIM800L...");
  checkSIM800Status();
  
  // Setup SMS reading mode
  setupSMSMode();

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
  
  // Check for incoming SMS periodically
  checkForIncomingSMS();
  
  // Small delay to prevent overwhelming the system
  delay(100);
}
