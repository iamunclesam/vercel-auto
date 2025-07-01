// utils/progressTracker.js
const clients = new Set();

function addClient(client) {
    clients.add(client);
}

function removeClient(client) {
    clients.delete(client);
}

function broadcastProgress(event, message, progress) {
    const data = JSON.stringify({
        event,
        message,
        progress,
        timestamp: new Date().toISOString()
    });

    clients.forEach(client => {
        try {
            client.write(`data: ${data}\n\n`);
        } catch (error) {
            console.error('Error sending progress to client:', error.message);
            removeClient(client);
        }
    });
}

module.exports = {
    addClient,
    removeClient,
    broadcastProgress
};