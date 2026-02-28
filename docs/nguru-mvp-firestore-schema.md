# Nguru MVP Database Schema (Cloud Firestore)

> Purpose: this is a specialized **Mind Object + Weak Point Interrogation** schema for Nguru. It is intentionally not a generic chatbot history model.

## 1) `users_mind_object` (The Profile / Mind Object)

**Collection path**: `users_mind_object/{uid}`

**Document ID**: must be the Firebase Auth `uid`.

### Fields
- `uid` (`string`, required)  
  Must exactly match the authenticated user's UID.
- `learning_analogies` (`array<string>`, required, default `[]`)  
  User's real-world interests (for example: `"street business"`, `"football"`).
- `voice_mode_enabled` (`boolean`, required, default `true`)  
  Keeps Nguru optimized for audio-first / low-literacy use.
- `created_at` (`timestamp`, optional)
- `updated_at` (`timestamp`, optional)

### Example document
```json
{
  "uid": "user_123",
  "learning_analogies": ["street business", "football"],
  "voice_mode_enabled": true,
  "created_at": "<server_timestamp>",
  "updated_at": "<server_timestamp>"
}
```

---

## 2) `active_learning_state` (The Progress Tracker)

**Collection path**: `active_learning_state/{uid}`

**Document ID**: must be the Firebase Auth `uid`.

### Fields
- `uid` (`string`, required)
- `current_topic` (`string`, required)
- `deferred_topics` (`array<string>`, required, default `[]`)  
  Advanced topics parked for later.
- `updated_at` (`timestamp`, optional)

### Example document
```json
{
  "uid": "user_123",
  "current_topic": "fractions",
  "deferred_topics": ["calculus limits", "vector spaces"],
  "updated_at": "<server_timestamp>"
}
```

---

## 3) `weak_point_mixer` (The Interrogator)

**Collection path**: `weak_point_mixer/{weakPointId}`

**Document ID**: auto-ID or deterministic ID (for example `"{uid}_{concept_slug}"`).

### Fields
- `uid` (`string`, required)
- `failed_concept` (`string`, required)  
  Exact concept user failed to grasp.
- `failure_count` (`integer`, required, minimum `0`)  
  If this reaches `2`, Nguru should switch from repeated explanation to visual/video support.
- `status` (`string`, required): only `"unresolved"` or `"resolved"`
- `created_at` (`timestamp`, optional)
- `updated_at` (`timestamp`, optional)

### Example document
```json
{
  "uid": "user_123",
  "failed_concept": "borrowing in subtraction",
  "failure_count": 2,
  "status": "unresolved",
  "created_at": "<server_timestamp>",
  "updated_at": "<server_timestamp>"
}
```

---

## Notes for Firebase AI Studio / App Logic
- Create profile docs with defaults on first sign-in:
  - `learning_analogies = []`
  - `voice_mode_enabled = true`
- Create progress doc with:
  - `current_topic = ""` (or your app's onboarding topic)
  - `deferred_topics = []`
- For weak points, increment `failure_count` each failed check-in.
- Trigger intervention (`video/visual`) when `failure_count >= 2` and `status == "unresolved"`.
