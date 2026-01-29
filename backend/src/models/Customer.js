const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
  const Customer = sequelize.define('Customer', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true
    },
    apiKey: {
      type: DataTypes.STRING,
      unique: true
    },
    role: {
      type: DataTypes.ENUM('admin', 'customer'),
      defaultValue: 'customer'
    },
    stripeCustomerId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    subscriptionStatus: {
      type: DataTypes.ENUM('active', 'inactive', 'trialing', 'past_due', 'canceled', 'canceling'),
      defaultValue: 'inactive'
    },
    subscriptionId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Plan type: 'free' (granted by admin), 'standard' ($29), 'volume' ($19 for 10+)
    planType: {
      type: DataTypes.ENUM('free', 'standard', 'volume'),
      defaultValue: 'standard'
    },
    // Admin can grant unlimited free access
    hasUnlimitedAccess: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    // Number of sub-account slots purchased
    subscriptionQuantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // GHL Integration fields
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
    },
    ghlCompanyId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ghlUserId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ghlConnected: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    tableName: 'customers',
    timestamps: true,
    hooks: {
      beforeCreate: async (customer) => {
        if (customer.password) {
          customer.password = await bcrypt.hash(customer.password, 12);
        }
        if (!customer.apiKey) {
          customer.apiKey = require('crypto').randomBytes(32).toString('hex');
        }
      },
      beforeUpdate: async (customer) => {
        if (customer.changed('password')) {
          customer.password = await bcrypt.hash(customer.password, 12);
        }
      }
    }
  });

  Customer.prototype.validatePassword = async function(password) {
    return bcrypt.compare(password, this.password);
  };

  Customer.prototype.toJSON = function() {
    const values = { ...this.get() };
    delete values.password;
    delete values.ghlAccessToken;
    delete values.ghlRefreshToken;
    return values;
  };

  return Customer;
};
