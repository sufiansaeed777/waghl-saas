const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const WhatsAppMapping = sequelize.define('WhatsAppMapping', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    subAccountId: {
      type: DataTypes.UUID,
      allowNull: false
      // Note: Foreign key relationship defined in models/index.js associations
    },
    // The real phone number (e.g., 393806510543)
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // The WhatsApp internal ID (e.g., 250830569660605)
    whatsappId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Contact name from WhatsApp (pushName)
    contactName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Last activity timestamp
    lastActivityAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'whatsapp_mappings',
    timestamps: true,
    indexes: [
      {
        fields: ['subAccountId', 'phoneNumber'],
        unique: true
      },
      {
        fields: ['subAccountId', 'whatsappId']
      }
    ]
  });

  return WhatsAppMapping;
};
