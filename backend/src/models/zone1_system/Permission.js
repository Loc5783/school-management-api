const mongoose = require('mongoose');

const PermissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  module: {
    type: String,
    enum: ['system', 'hr', 'school', 'finance', 'nutrition', 'procurement', 'report'],
    required: true
  },
  resource: {
    type: String,
    required: true,
    trim: true
  },
  action: {
    type: String,
    enum: ['create', 'read', 'update', 'delete', 'approve', 'manage', 'view_own'],
    required: true
  }
}, { timestamps: true });

// Tạo compound index để đảm bảo unique (module + resource + action)
PermissionSchema.index({ module: 1, resource: 1, action: 1 }, { unique: true });

module.exports = mongoose.model('Permission', PermissionSchema);