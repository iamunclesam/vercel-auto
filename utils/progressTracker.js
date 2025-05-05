// utils/progressTracker.js
const clients = new Set();

function broadcastProgress(stage, message, percentage) {
    const progressData = JSON.stringify({ stage, message, percentage });
    clients.forEach(client => {
        try {
            client.write(`event: progress\ndata: ${progressData}\n\n`);
        } catch (err) {
            // Remove broken connections
            clients.delete(client);
        }
    });
}

function addClient(res) {
    clients.add(res);
}

function removeClient(res) {
    clients.delete(res);
}

module.exports = {
    broadcastProgress,
    addClient,
    removeClient,
    clients
};