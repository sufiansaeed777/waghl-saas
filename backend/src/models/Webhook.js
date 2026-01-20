const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Webhook = sequelize.define('Webhook', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    subAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: 'sub_accounts',
        key: 'id'
      }
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isUrl: true
      }
    },
    secret: {
      type: DataTypes.STRING,
      allowNull: true
    },
    events: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ['message.received', 'message.sent', 'connection.status']
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastTriggered: {
      type: DataTypes.DATE,
      allowNull: true
    },
    failureCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    tableName: 'webhooks',
    timestamps: true,
    hooks: {
      beforeCreate: async (webhook) => {
        if (!webhook.secret) {
          webhook.secret = require('crypto').randomBytes(32).toString('hex');
        }
      }
    }
  });

  return Webhook;
};
