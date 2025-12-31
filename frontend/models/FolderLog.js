const mongoose = require('mongoose');

const folderLogSchema = new mongoose.Schema({
  tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
  folders: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      date: { type: String, required: true },
      description: { type: String, default: '' },
      folderName: { type: String, default: '' }
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('FolderLog', folderLogSchema); 