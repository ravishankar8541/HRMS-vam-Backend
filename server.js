// Entry point for cPanel/LiteSpeed, Passenger and normal `npm start` deployments.
// Hosting loaders use require(), so api/index.js cannot rely on require.main alone.
const app = require('./api/index');

app.startServer().catch(error => {
  console.error('Server startup failed:', error);
  process.exit(1);
});
