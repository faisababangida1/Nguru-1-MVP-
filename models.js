const mongoose = require('mongoose');

// 1. User Authentication Schema
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // This will be hashed
  createdAt: { type: Date, default: Date.now }
});

// 2. users_mind_object (The Profile)
const MindObjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  learning_analogies: { type: [String], default: [] }, 
  voice_mode_enabled: { type: Boolean, default: true }
});

// 3. active_learning_state (The Progress Tracker)
const LearningStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  current_topic: { type: String, default: "" },
  deferred_topics: { type: [String], default: [] }
});

// 4. weak_point_mixer (The Interrogator)
const WeakPointSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  failed_concept: { type: String, required: true },
  failure_count: { type: Number, default: 1 },
  status: { type: String, enum: ['unresolved', 'resolved'], default: 'unresolved' }
});

module.exports = {
  User: mongoose.model('User', UserSchema),
  MindObject: mongoose.model('MindObject', MindObjectSchema),
  LearningState: mongoose.model('LearningState', LearningStateSchema),
  WeakPoint: mongoose.model('WeakPoint', WeakPointSchema)
};
