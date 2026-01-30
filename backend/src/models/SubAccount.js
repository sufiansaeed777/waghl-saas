const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SubAccount = sequelize.define('SubAccount', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'customers',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'Pending GHL Connection...'
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    apiKey: {
      type: DataTypes.STRING,
      unique: true
    },
    status: {
      type: DataTypes.ENUM('disconnected', 'connecting', 'connected', 'qr_ready'),
      defaultValue: 'disconnected'
    },
    sessionData: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    lastConnected: {
      type: DataTypes.DATE,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    isPaid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    // Admin can gift free access to specific sub-account
    isGifted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    // GHL Integration fields
    ghlLocationId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ghlLocationName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ghlConnected: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    ghlAccessToken: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ghlRefreshToken: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ghlTokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'sub_accounts',
    timestamps: true,
    hooks: {
      beforeCreate: async (subAccount) => {
        if (!subAccount.apiKey) {
          subAccount.apiKey = require('crypto').randomBytes(32).toString('hex');
        }
      }
    }
  });

  // Hide sensitive data in API responses
  SubAccount.prototype.toJSON = function() {
    const values = { ...this.get() };
    delete values.ghlAccessToken;
    delete values.ghlRefreshToken;
    delete values.sessionData;
    return values;
  };

  return SubAccount;
};
