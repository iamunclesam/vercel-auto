const clients = new Set();

function addClient(client) {
  clients.add(client);
}

function removeClient(client) {
  clients.delete(client);
}

function sendProgress(stage, message, percentage) {
  const progressData = JSON.stringify({ stage, message, percentage });
  
  clients.forEach(client => {
    try {
      client.write(`data: ${progressData}\n\n`);
    } catch (error) {
      console.error('Error sending progress to client:', error.message);
      removeClient(client);
    }
  });
}

module.exports = {
  addClient,
  removeClient,
  sendProgress
};