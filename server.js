// Entry point for cPanel/Passenger and normal `npm start` deployments.
// Passenger loads startup files with require(), so api/index.js cannot rely on require.main.
const app = require('./api/index');

app.startServer().catch(error => {
  console.error('Server startup failed:', error);
  process.exit(1);
});
