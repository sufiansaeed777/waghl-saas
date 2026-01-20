const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    subAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'sub_accounts',
        key: 'id'
      }
    },
    messageId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    direction: {
      type: DataTypes.ENUM('inbound', 'outbound'),
      allowNull: false
    },
    fromNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    toNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    messageType: {
      type: DataTypes.ENUM('text', 'image', 'document', 'audio', 'video'),
      defaultValue: 'text'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    mediaUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'delivered', 'read', 'failed'),
      defaultValue: 'pending'
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true
    }
  }, {
    tableName: 'messages',
    timestamps: true,
    indexes: [
      { fields: ['subAccountId'] },
      { fields: ['fromNumber'] },
      { fields: ['toNumber'] },
      { fields: ['createdAt'] }
    ]
  });

  return Message;
};
