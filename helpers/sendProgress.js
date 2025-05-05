
// In your deployment script, add progress updates:
function sendProgress(stage, message, percentage) {
    const progressData = JSON.stringify({ stage, message, percentage });
    clients.forEach(client => {
        client.write(`data: ${progressData}\n\n`);
    });
}