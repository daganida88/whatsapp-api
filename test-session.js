const SessionManager = require('./src/sessionManager');

async function testSession() {
    console.log('🚀 Starting session test...');
    
    const sessionManager = new SessionManager();
    
    try {
        console.log('📱 Creating session: phone1');
        const result = await sessionManager.createSession('phone1');
        console.log('✅ Session created:', result);
        
        // Wait for authentication
        console.log('⏳ Waiting for authentication (scan QR code)...');
        
        // Check status every 5 seconds
        const checkStatus = setInterval(() => {
            const status = sessionManager.getSessionStatus('phone1');
            console.log('📊 Session status:', {
                ready: status.ready,
                hasQR: status.hasQR,
                status: status.status
            });
            
            if (status.ready) {
                console.log('🎉 Session is ready!');
                console.log('📱 User info:', status.info);
                clearInterval(checkStatus);
                
                // Test sending a message
                testMessage(sessionManager);
            }
        }, 5000);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function testMessage(sessionManager) {
    try {
        console.log('💬 Sending test message...');
        const result = await sessionManager.sendMessage(
            'phone1', 
            '120363403302220749@g.us', 
            'Hello from programmatic test! 🤖'
        );
        console.log('✅ Message sent:', result.id._serialized);
    } catch (error) {
        console.error('❌ Message error:', error.message);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down...');
    process.exit(0);
});

testSession();