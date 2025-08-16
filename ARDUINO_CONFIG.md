# Arduino ESP32 Configuration Guide

## 🔧 **Basic Configuration**

Update these values in your `project.ino` file:

```cpp
// --- WIFI SETTINGS ---
const char* ssid = "Your_WiFi_SSID";
const char* password = "Your_WiFi_Password";

// --- MQTT SETTINGS ---
const char* mqtt_server = "YOUR_SERVER_PUBLIC_IP"; // e.g., "95.217.15.58"
const int mqtt_port = 1883;
const char* mqtt_topic = "test/topic";
const char* mqtt_username = ""; // Leave empty if no auth required
const char* mqtt_password = ""; // Leave empty if no auth required
const char* mqtt_client_id = "ESP32-ChickSMS-Client";
```

## 🔐 **MQTT Authentication (Optional but Recommended)**

### **Step 1: Create MQTT User on Server**

On your Ubuntu server, create an MQTT user:

```bash
# Create password file
sudo mosquitto_passwd -c /etc/mosquitto/passwd esp32_client

# Add additional users if needed
sudo mosquitto_passwd /etc/mosquitto/passwd another_user
```

### **Step 2: Configure Mosquitto for Authentication**

Edit mosquitto config:
```bash
sudo nano /etc/mosquitto/mosquitto.conf
```

Add these lines:
```conf
# Listen on all interfaces
listener 1883 0.0.0.0

# Enable authentication
password_file /etc/mosquitto/passwd
allow_anonymous false

# Optional: Enable logging
log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
log_type notice
log_type information
```

### **Step 3: Restart Mosquitto**

```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto
```

### **Step 4: Update Arduino Code**

```cpp
// Update these in your Arduino code
const char* mqtt_username = "esp32_client";
const char* mqtt_password = "your_secure_password";
```

## 📱 **SMS Functionality**

Your Arduino now supports:

### **1. Outgoing SMS (Server → Arduino)**
- Receives SMS requests via MQTT topic `test/topic`
- Format: `phoneNumber|message`
- Sends SMS via SIM800L module
- Reports status back to server

### **2. Incoming SMS (Arduino → Server)**
- Automatically checks for new SMS every 10 seconds
- Publishes to MQTT topic `sms/incoming`
- Format: `phoneNumber|message|timestamp`
- Deletes SMS from SIM card after processing

### **3. Status Reporting**
- Reports SMS success/failure to server
- Publishes to MQTT topic `sms/status`
- Format: `phoneNumber|status|errorMessage`

## 🗄️ **Database Integration**

All SMS activities are automatically stored in the ChickSMS database:

### **Outgoing SMS Table (`smsLog`)**
- Status tracking (PENDING, SENT, FAILED)
- Error messages and retry counts
- User association and timestamps

### **Incoming SMS Table (`incomingSms`)**
- Stores all received SMS
- Processing status tracking
- Automatic timestamping

## 📊 **Monitoring & APIs**

### **View Incoming SMS**
```bash
curl -X GET http://your-server/api/logs/incoming \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### **View Failed SMS**
```bash
curl -X GET http://your-server/api/logs/failed \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### **View SMS Statistics**
```bash
curl -X GET http://your-server/api/logs/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### **Mark Incoming SMS as Processed**
```bash
curl -X PUT http://your-server/api/logs/incoming/SMS_ID/processed \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"processed": true}'
```

## 🔍 **Troubleshooting**

### **MQTT Connection Issues**
```cpp
// Add debug output in Arduino code
Serial.print("MQTT connection state: ");
Serial.println(client.state());
```

**Connection State Codes:**
- `-4`: Connection timeout
- `-3`: Connection lost
- `-2`: Connect failed
- `-1`: Disconnected
- `0`: Connected
- `1`: Wrong protocol
- `2`: Client ID rejected
- `3`: Server unavailable
- `4`: Bad username/password
- `5`: Not authorized

### **SIM800L Issues**
```cpp
// Check SIM800L status
if (!checkSIM800Status()) {
  Serial.println("SIM800L not responding");
  // Check wiring, power supply, and baud rate
}
```

### **SMS Reading Issues**
- Ensure SIM card has credit
- Check network signal strength
- Verify SIM card supports SMS
- Check AT command responses

## 🚀 **Advanced Features**

### **Custom MQTT Topics**
You can modify the Arduino code to use custom topics:

```cpp
// In your Arduino setup()
client.subscribe("custom/outgoing/topic");

// In callback function
if (strcmp(topic, "custom/outgoing/topic") == 0) {
  // Handle custom SMS requests
}

// For reporting
client.publish("custom/status/topic", statusMessage.c_str());
client.publish("custom/incoming/topic", incomingMessage.c_str());
```

### **Multiple Arduino Clients**
Each Arduino should have a unique client ID:

```cpp
const char* mqtt_client_id = "ESP32-ChickSMS-Device-001";
```

### **Bulk SMS Support**
Your Arduino automatically handles bulk SMS - the server sends individual messages for each recipient.

## 🔒 **Security Best Practices**

1. **Use MQTT Authentication**: Always enable username/password authentication
2. **Secure WiFi**: Use WPA2 or better WiFi security
3. **Strong Passwords**: Use strong passwords for MQTT and WiFi
4. **Regular Updates**: Keep Arduino libraries updated
5. **Monitor Logs**: Regular monitoring of SMS logs and MQTT activity

## 📈 **Performance Optimization**

### **SMS Check Interval**
Adjust the SMS check frequency:
```cpp
const unsigned long SMS_CHECK_INTERVAL = 5000; // Check every 5 seconds
```

### **MQTT Keep Alive**
Optimize MQTT connection:
```cpp
// In setup()
client.setKeepAlive(60); // 60 second keep alive
```

### **Memory Management**
For long-running operation, consider:
- Periodic ESP32 restart
- String memory cleanup
- Buffer size management

---

Your ChickSMS system is now fully integrated with two-way SMS communication and comprehensive database logging! 🎉
