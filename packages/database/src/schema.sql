PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  movie_lens_id INTEGER UNIQUE,
  tmdb_id TEXT NOT NULL UNIQUE,
  imdb_id TEXT UNIQUE,
  title TEXT NOT NULL,
  original_title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  homepage TEXT NOT NULL DEFAULT '',
  original_language TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  release_date TEXT,
  release_year INTEGER NOT NULL,
  runtime_minutes INTEGER NOT NULL CHECK (runtime_minutes >= 0),
  adult INTEGER NOT NULL DEFAULT 0 CHECK (adult IN (0, 1)),
  popularity REAL NOT NULL DEFAULT 0 CHECK (popularity >= 0),
  vote_average REAL NOT NULL DEFAULT 0 CHECK (vote_average >= 0),
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  poster_path TEXT,
  backdrop_path TEXT,
  belongs_to_collection_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movie_genres (
  movie_id TEXT NOT NULL,
  genre_id INTEGER NOT NULL,
  genre_name TEXT NOT NULL,
  genre_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (movie_id, genre_id),
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_cast (
  movie_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  cast_order INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER NOT NULL,
  person_name TEXT NOT NULL,
  character_name TEXT NOT NULL DEFAULT '',
  gender INTEGER NOT NULL DEFAULT 0 CHECK (gender >= 0),
  profile_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (movie_id, credit_id),
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_crew (
  movie_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  person_name TEXT NOT NULL,
  department TEXT NOT NULL,
  job TEXT NOT NULL,
  gender INTEGER NOT NULL DEFAULT 0 CHECK (gender >= 0),
  profile_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (movie_id, credit_id),
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_features (
  movie_id TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL DEFAULT '',
  genres_json TEXT NOT NULL DEFAULT '[]',
  cast_json TEXT NOT NULL DEFAULT '[]',
  crew_json TEXT NOT NULL DEFAULT '[]',
  feature_vector_json TEXT NOT NULL DEFAULT '[]',
  feature_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_ratings_stats (
  movie_id TEXT PRIMARY KEY,
  movie_lens_id INTEGER UNIQUE,
  rating_count INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  rating_average REAL NOT NULL DEFAULT 0 CHECK (rating_average >= 0),
  rating_sum REAL NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  rating_min REAL,
  rating_max REAL,
  rating_stddev REAL NOT NULL DEFAULT 0 CHECK (rating_stddev >= 0),
  first_rating_at TEXT,
  last_rating_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_import_runs (
  id TEXT PRIMARY KEY,
  dataset_key TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  movies_imported INTEGER NOT NULL DEFAULT 0 CHECK (movies_imported >= 0),
  features_imported INTEGER NOT NULL DEFAULT 0 CHECK (features_imported >= 0),
  rating_stats_imported INTEGER NOT NULL DEFAULT 0 CHECK (rating_stats_imported >= 0),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS dataset_movie_links (
  movie_lens_id INTEGER PRIMARY KEY,
  tmdb_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataset_uploads (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('movies', 'links', 'credits', 'ratings')),
  storage_path TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'waiting_dependencies', 'success', 'partial_error', 'error')),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  imported_rows INTEGER NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  rejected_rows INTEGER NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  waiting_dependency_rows INTEGER NOT NULL DEFAULT 0 CHECK (waiting_dependency_rows >= 0),
  failures_json TEXT NOT NULL DEFAULT '[]',
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS dataset_import_diagnostics (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  line_start INTEGER CHECK (line_start IS NULL OR line_start > 0),
  line_end INTEGER CHECK (line_end IS NULL OR line_end > 0),
  field_name TEXT,
  value_preview TEXT,
  diagnostic_category TEXT NOT NULL CHECK (diagnostic_category IN ('structure', 'validation', 'reference', 'integrity')),
  reason TEXT NOT NULL CHECK (reason IN ('invalid_encoding', 'invalid_header', 'invalid_row', 'invalid_field', 'movie_not_found', 'link_not_found', 'duplicate_value')),
  rule_code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (upload_id) REFERENCES dataset_uploads (id) ON DELETE CASCADE,
  CHECK (line_end IS NULL OR line_start IS NULL OR line_end >= line_start)
);

CREATE TABLE IF NOT EXISTS dataset_import_diagnostic_summaries (
  upload_id TEXT NOT NULL,
  diagnostic_category TEXT NOT NULL CHECK (diagnostic_category IN ('structure', 'validation', 'reference', 'integrity')),
  field_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL CHECK (reason IN ('invalid_encoding', 'invalid_header', 'invalid_row', 'invalid_field', 'movie_not_found', 'link_not_found', 'duplicate_value')),
  rule_code TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (upload_id, diagnostic_category, field_name, reason, rule_code),
  FOREIGN KEY (upload_id) REFERENCES dataset_uploads (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_import_rating_keys (
  upload_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  movie_lens_id INTEGER NOT NULL,
  PRIMARY KEY (upload_id, user_id, movie_lens_id),
  FOREIGN KEY (upload_id) REFERENCES dataset_uploads (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_import_jobs (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL CHECK (file_type IN ('movies', 'links', 'credits', 'ratings')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'waiting_dependencies', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (upload_id) REFERENCES dataset_uploads (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  expires_at_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS anonymous_profiles (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  invalidated_at_ms INTEGER,
  CHECK (expires_at_ms > created_at_ms)
);

CREATE TABLE IF NOT EXISTS anonymous_profile_preferences (
  profile_id TEXT PRIMARY KEY,
  genres_json TEXT NOT NULL DEFAULT '[]',
  runtime_preference TEXT NOT NULL CHECK (runtime_preference IN ('any', 'short', 'medium', 'long')),
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anonymous_profile_movie_feedback (
  profile_id TEXT NOT NULL,
  movie_id TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('watched', 'liked', 'disliked')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (profile_id, movie_id)
);

CREATE TABLE IF NOT EXISTS session_preferences (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  genres_json TEXT NOT NULL DEFAULT '[]',
  runtime_preference TEXT NOT NULL CHECK (runtime_preference IN ('any', 'short', 'medium', 'long')),
  free_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_movie_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  movie_id TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('watched', 'liked', 'disliked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  UNIQUE (session_id, movie_id, feedback)
);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  recommendation_round INTEGER NOT NULL DEFAULT 1 CHECK (recommendation_round > 0),
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id TEXT PRIMARY KEY,
  recommendation_event_id TEXT NOT NULL,
  movie_id TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('positive', 'negative')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recommendation_event_id) REFERENCES recommendation_events (id) ON DELETE CASCADE,
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
  UNIQUE (recommendation_event_id, movie_id)
);

CREATE TABLE IF NOT EXISTS recommendation_rounds (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  genres_json TEXT NOT NULL DEFAULT '[]',
  runtime_preference TEXT NOT NULL CHECK (runtime_preference IN ('any', 'short', 'medium', 'long')),
  ranking_version TEXT NOT NULL,
  model_version TEXT,
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (session_id, sequence)
);

CREATE TABLE IF NOT EXISTS recommendation_impressions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  movie_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  score REAL NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (round_id, movie_id)
);

CREATE TABLE IF NOT EXISTS recommendation_impression_feedbacks (
  id TEXT PRIMARY KEY,
  impression_id TEXT NOT NULL UNIQUE,
  feedback TEXT NOT NULL CHECK (feedback IN ('liked', 'disliked', 'watched_neutral', 'blocked')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movie_genres_genre_name ON movie_genres (genre_name);
CREATE INDEX IF NOT EXISTS idx_movie_cast_person_name ON movie_cast (person_name);
CREATE INDEX IF NOT EXISTS idx_movie_crew_person_name ON movie_crew (person_name);
CREATE INDEX IF NOT EXISTS idx_movie_ratings_stats_rating_average ON movie_ratings_stats (rating_average);
CREATE INDEX IF NOT EXISTS idx_dataset_import_runs_lookup ON dataset_import_runs (dataset_key, environment, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dataset_import_runs_running ON dataset_import_runs (dataset_key, environment) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_dataset_uploads_status_created_at ON dataset_uploads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataset_import_diagnostics_upload_line ON dataset_import_diagnostics (upload_id, line_start, id);
CREATE INDEX IF NOT EXISTS idx_dataset_import_diagnostics_summary ON dataset_import_diagnostics (upload_id, diagnostic_category, rule_code, field_name);
CREATE INDEX IF NOT EXISTS idx_dataset_import_diagnostic_summaries_upload ON dataset_import_diagnostic_summaries (upload_id, diagnostic_category, reason, rule_code);
CREATE INDEX IF NOT EXISTS idx_dataset_import_rating_keys_upload ON dataset_import_rating_keys (upload_id);
CREATE INDEX IF NOT EXISTS idx_dataset_import_jobs_status_created_at ON dataset_import_jobs (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dataset_import_jobs_single_processing ON dataset_import_jobs (status) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_sessions_status_created_at ON sessions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_session_preferences_session_id ON session_preferences (session_id);
CREATE INDEX IF NOT EXISTS idx_session_movie_feedback_session_id ON session_movie_feedback (session_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_events_session_id ON recommendation_events (session_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_event_id ON recommendation_feedback (recommendation_event_id);
