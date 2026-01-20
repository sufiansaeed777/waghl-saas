const { Sequelize } = require('sequelize');
const config = require('../config/database');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    pool: dbConfig.pool
  }
);

// Import models
const Customer = require('./Customer')(sequelize);
const SubAccount = require('./SubAccount')(sequelize);
const Message = require('./Message')(sequelize);
const Webhook = require('./Webhook')(sequelize);

// Define associations
Customer.hasMany(SubAccount, { foreignKey: 'customerId', as: 'subAccounts' });
SubAccount.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });

SubAccount.hasMany(Message, { foreignKey: 'subAccountId', as: 'messages' });
Message.belongsTo(SubAccount, { foreignKey: 'subAccountId', as: 'subAccount' });

SubAccount.hasOne(Webhook, { foreignKey: 'subAccountId', as: 'webhook' });
Webhook.belongsTo(SubAccount, { foreignKey: 'subAccountId', as: 'subAccount' });

module.exports = {
  sequelize,
  Sequelize,
  Customer,
  SubAccount,
  Message,
  Webhook
};
