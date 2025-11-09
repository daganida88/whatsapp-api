const express = require('express');
const router = express.Router();

// Serve the main UI page
router.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp API Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fa;
            color: #2c3e50;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: linear-gradient(135deg, #25D366, #128C7E);
            color: white;
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            box-shadow: 0 4px 15px rgba(37, 211, 102, 0.3);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }

        .header p {
            opacity: 0.9;
            font-size: 1.1rem;
        }

        .sessions-container {
            margin-bottom: 2rem;
        }

        .session-card {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            border-left: 4px solid #25D366;
        }

        .session-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }

        .session-title {
            font-size: 1.4rem;
            font-weight: 600;
            color: #2c3e50;
        }

        .status-badge {
            padding: 0.3rem 1rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
        }

        .status-ready {
            background: #d4edda;
            color: #155724;
        }

        .status-not-ready {
            background: #f8d7da;
            color: #721c24;
        }

        .controls {
            margin-bottom: 1rem;
        }

        .btn {
            background: #25D366;
            color: white;
            border: none;
            padding: 0.7rem 1.5rem;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-right: 0.5rem;
            transition: background 0.3s;
        }

        .btn:hover {
            background: #128C7E;
        }

        .btn-secondary {
            background: #6c757d;
        }

        .btn-secondary:hover {
            background: #545b62;
        }

        .search-box {
            width: 100%;
            padding: 1rem;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 1rem;
            margin-bottom: 1rem;
        }

        .tabs {
            display: flex;
            margin-bottom: 1rem;
            border-bottom: 1px solid #ddd;
        }

        .tab {
            background: none;
            border: none;
            padding: 1rem 1.5rem;
            cursor: pointer;
            font-size: 1rem;
            border-bottom: 3px solid transparent;
            transition: all 0.3s;
        }

        .tab.active {
            border-bottom-color: #25D366;
            color: #25D366;
            font-weight: 600;
        }

        .chat-list {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        .chat-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.2s;
        }

        .chat-item:hover {
            background: #f8f9fa;
        }

        .chat-item:last-child {
            border-bottom: none;
        }

        .chat-info {
            flex: 1;
        }

        .chat-name {
            font-weight: 600;
            font-size: 1.1rem;
            margin-bottom: 0.3rem;
            color: #2c3e50;
        }

        .chat-id {
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            color: #6c757d;
            margin-bottom: 0.3rem;
        }

        .chat-meta {
            font-size: 0.8rem;
            color: #6c757d;
        }

        .group-badge {
            background: #25D366;
            color: white;
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.7rem;
            margin-left: 0.5rem;
        }

        .contact-badge {
            background: #007bff;
            color: white;
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.7rem;
            margin-left: 0.5rem;
        }

        .copy-btn {
            background: #6c757d;
            color: white;
            border: none;
            padding: 0.3rem 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
        }

        .copy-btn:hover {
            background: #545b62;
        }

        .loading {
            text-align: center;
            padding: 3rem;
            color: #6c757d;
        }

        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
        }

        .empty-state {
            text-align: center;
            padding: 3rem;
            color: #6c757d;
        }

        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .session-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .chat-item {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .copy-btn {
                margin-top: 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 WhatsApp API Dashboard</h1>
            <p>Manage your WhatsApp sessions and browse your chats & groups</p>
        </div>

        <div class="sessions-container" id="sessions-container">
            <div class="loading">Loading sessions...</div>
        </div>
    </div>

    <script>
        let currentSession = null;
        let allChats = [];
        let filteredChats = [];

        async function loadSessions() {
            try {
                const response = await fetch('/api/sessions');
                const data = await response.json();
                
                if (data.success) {
                    renderSessions(data);
                } else {
                    showError('Failed to load sessions');
                }
            } catch (error) {
                showError('Error connecting to API: ' + error.message);
            }
        }

        function renderSessions(data) {
            const container = document.getElementById('sessions-container');
            
            if (data.count === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <h3>No active sessions found</h3>
                        <p>Initialize a session first using the API</p>
                    </div>
                \`;
                return;
            }

            let html = '';
            for (const [sessionId, session] of Object.entries(data.sessions)) {
                const isReady = session.ready;
                const statusClass = isReady ? 'status-ready' : 'status-not-ready';
                const statusText = isReady ? 'Ready' : 'Not Ready';
                
                html += \`
                    <div class="session-card">
                        <div class="session-header">
                            <div class="session-title">📱 Session: \${sessionId}</div>
                            <span class="status-badge \${statusClass}">\${statusText}</span>
                        </div>
                        <div class="controls">
                            <button class="btn" onclick="loadChats('\${sessionId}')" \${!isReady ? 'disabled' : ''}>
                                📋 Load Chats & Groups
                            </button>
                            <button class="btn btn-secondary" onclick="refreshSession('\${sessionId}')">
                                🔄 Refresh Status
                            </button>
                        </div>
                        <div id="chats-\${sessionId}" class="chats-container"></div>
                    </div>
                \`;
            }
            
            container.innerHTML = html;
        }

        async function loadChats(sessionId) {
            const container = document.getElementById(\`chats-\${sessionId}\`);
            container.innerHTML = '<div class="loading">Loading chats...</div>';
            currentSession = sessionId;

            try {
                const response = await fetch(\`/api/sessions/\${sessionId}/chats\`);
                const data = await response.json();
                
                if (data.success) {
                    allChats = data.chats;
                    filteredChats = allChats;
                    renderChats(container);
                } else {
                    container.innerHTML = \`<div class="error">Error: \${data.message}</div>\`;
                }
            } catch (error) {
                container.innerHTML = \`<div class="error">Error loading chats: \${error.message}</div>\`;
            }
        }

        function renderChats(container) {
            if (filteredChats.length === 0) {
                container.innerHTML = '<div class="empty-state">No chats found</div>';
                return;
            }

            const groups = filteredChats.filter(chat => chat.isGroup);
            const contacts = filteredChats.filter(chat => !chat.isGroup);

            const html = \`
                <input type="text" class="search-box" placeholder="🔍 Search chats and groups..." onkeyup="filterChats(this.value)">
                
                <div class="tabs">
                    <button class="tab active" onclick="showTab('all')">All (\${filteredChats.length})</button>
                    <button class="tab" onclick="showTab('groups')">Groups (\${groups.length})</button>
                    <button class="tab" onclick="showTab('contacts')">Contacts (\${contacts.length})</button>
                </div>
                
                <div class="chat-list" id="chat-list">
                    \${renderChatList(filteredChats)}
                </div>
            \`;
            
            container.innerHTML = html;
        }

        function renderChatList(chats) {
            return chats.map(chat => {
                const badge = chat.isGroup ? 
                    \`<span class="group-badge">GROUP</span>\` : 
                    \`<span class="contact-badge">CONTACT</span>\`;
                
                const participants = chat.isGroup ? \` • \${chat.participants} members\` : '';
                const lastMsg = chat.lastMessage ? chat.lastMessage : 'No messages';
                
                return \`
                    <div class="chat-item">
                        <div class="chat-info">
                            <div class="chat-name">
                                \${chat.name}
                                \${badge}
                            </div>
                            <div class="chat-id">\${chat.id}</div>
                            <div class="chat-meta">
                                Last: \${lastMsg.substring(0, 60)}\${lastMsg.length > 60 ? '...' : ''}\${participants}
                            </div>
                        </div>
                        <button class="copy-btn" onclick="copyToClipboard('\${chat.id}')">📋 Copy ID</button>
                    </div>
                \`;
            }).join('');
        }

        function filterChats(searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredChats = allChats.filter(chat => 
                chat.name.toLowerCase().includes(term) || 
                chat.id.toLowerCase().includes(term) ||
                chat.lastMessage.toLowerCase().includes(term)
            );
            
            const chatList = document.getElementById('chat-list');
            chatList.innerHTML = renderChatList(filteredChats);
            
            // Update tab counts
            const groups = filteredChats.filter(chat => chat.isGroup);
            const contacts = filteredChats.filter(chat => !chat.isGroup);
            document.querySelector('.tabs').innerHTML = \`
                <button class="tab active" onclick="showTab('all')">All (\${filteredChats.length})</button>
                <button class="tab" onclick="showTab('groups')">Groups (\${groups.length})</button>
                <button class="tab" onclick="showTab('contacts')">Contacts (\${contacts.length})</button>
            \`;
        }

        function showTab(type) {
            // Update active tab
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            event.target.classList.add('active');
            
            // Filter chats
            let chatsToShow = [];
            if (type === 'groups') {
                chatsToShow = filteredChats.filter(chat => chat.isGroup);
            } else if (type === 'contacts') {
                chatsToShow = filteredChats.filter(chat => !chat.isGroup);
            } else {
                chatsToShow = filteredChats;
            }
            
            const chatList = document.getElementById('chat-list');
            chatList.innerHTML = renderChatList(chatsToShow);
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                // Visual feedback
                const originalText = event.target.textContent;
                event.target.textContent = '✅ Copied!';
                event.target.style.background = '#28a745';
                
                setTimeout(() => {
                    event.target.textContent = originalText;
                    event.target.style.background = '#6c757d';
                }, 1000);
            }).catch(err => {
                alert('Failed to copy: ' + err);
            });
        }

        async function refreshSession(sessionId) {
            await loadSessions();
        }

        function showError(message) {
            const container = document.getElementById('sessions-container');
            container.innerHTML = \`<div class="error">\${message}</div>\`;
        }

        // Load sessions on page load
        loadSessions();
        
        // Auto-refresh every 30 seconds
        setInterval(loadSessions, 30000);
    </script>
</body>
</html>`;
  
  res.send(html);
});

module.exports = router;