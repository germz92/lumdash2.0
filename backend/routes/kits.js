const express = require('express');
const Kit = require('../models/Kit');
const PackageTemplate = require('../models/PackageTemplate');

function canEditKit(kit, user) {
  if (!kit || !user) return false;
  if (user.role === 'admin' || user.role === 'production_manager') return true;
  return kit.createdBy && kit.createdBy.toString() === user.id.toString();
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    brand: String(item.brand || '').trim(),
    model: String(item.model || '').trim(),
    category: String(item.category || '').trim(),
    quantity: Math.max(1, parseInt(item.quantity, 10) || 1)
  })).filter((item) => item.brand && item.model && item.category);
}

module.exports = function createKitsRouter() {
  const router = express.Router();

  // List all kits
  router.get('/', async (req, res) => {
    try {
      const kits = await Kit.find()
        .populate('createdBy', 'fullName')
        .sort({ name: 1 });
      res.json(kits);
    } catch (error) {
      console.error('Error fetching kits:', error);
      res.status(500).json({ error: 'Failed to fetch kits' });
    }
  });

  // Get one kit
  router.get('/:id', async (req, res) => {
    try {
      const kit = await Kit.findById(req.params.id).populate('createdBy', 'fullName');
      if (!kit) return res.status(404).json({ error: 'Kit not found' });
      res.json(kit);
    } catch (error) {
      console.error('Error fetching kit:', error);
      res.status(500).json({ error: 'Failed to fetch kit' });
    }
  });

  // Create kit — anyone signed in
  router.post('/', async (req, res) => {
    try {
      const { name, description, items } = req.body;
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const kit = new Kit({
        name: cleanName,
        description: String(description || '').trim(),
        items: cleanItems(items),
        createdBy: req.user.id
      });

      await kit.save();
      await kit.populate('createdBy', 'fullName');
      res.status(201).json(kit);
    } catch (error) {
      console.error('Error creating kit:', error);
      if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to create kit' });
    }
  });

  // Update kit — creator, admin, or production manager
  router.put('/:id', async (req, res) => {
    try {
      const kit = await Kit.findById(req.params.id);
      if (!kit) return res.status(404).json({ error: 'Kit not found' });
      if (!canEditKit(kit, req.user)) {
        return res.status(403).json({ error: 'Not authorized to edit this kit' });
      }

      const { name, description, items } = req.body;
      if (name !== undefined) {
        const cleanName = String(name || '').trim();
        if (!cleanName) return res.status(400).json({ error: 'Name is required' });
        kit.name = cleanName;
      }
      if (description !== undefined) {
        kit.description = String(description || '').trim();
      }
      if (items !== undefined) {
        kit.items = cleanItems(items);
      }

      await kit.save();
      await kit.populate('createdBy', 'fullName');
      res.json(kit);
    } catch (error) {
      console.error('Error updating kit:', error);
      if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to update kit' });
    }
  });

  // Delete kit — refused when templates still reference it
  router.delete('/:id', async (req, res) => {
    try {
      const kit = await Kit.findById(req.params.id);
      if (!kit) return res.status(404).json({ error: 'Kit not found' });
      if (!canEditKit(kit, req.user)) {
        return res.status(403).json({ error: 'Not authorized to delete this kit' });
      }

      const templatesUsing = await PackageTemplate.find({
        'kits.kitId': kit._id
      }).select('name').lean();

      if (templatesUsing.length > 0) {
        const names = templatesUsing.map((t) => t.name);
        return res.status(409).json({
          error: `This kit is used by ${names.length} template${names.length === 1 ? '' : 's'}: ${names.join(', ')}. Remove it from those templates first.`,
          templates: names
        });
      }

      await Kit.findByIdAndDelete(kit._id);
      res.json({ message: 'Kit deleted successfully' });
    } catch (error) {
      console.error('Error deleting kit:', error);
      res.status(500).json({ error: 'Failed to delete kit' });
    }
  });

  return router;
};
