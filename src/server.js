const app = require('./app');
const { sequelize } = require('./models');
const { port } = require('./config/env');

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync(); // creates tables if missing; see documentation/05-database-design/schema.sql
    app.listen(port, () => console.log(`UniServe API listening on port ${port}`));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
