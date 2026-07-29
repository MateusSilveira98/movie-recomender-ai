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
  runtime_minutes INTEGER NOT NULL CHECK (runtime_minutes > 0),
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

CREATE TABLE IF NOT EXISTS movie_keywords (
  movie_id TEXT NOT NULL,
  keyword_id INTEGER NOT NULL,
  keyword_name TEXT NOT NULL,
  keyword_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (movie_id, keyword_id),
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
  keywords_json TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned'))
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
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_movie_genres_genre_name ON movie_genres (genre_name);
CREATE INDEX IF NOT EXISTS idx_movie_keywords_keyword_name ON movie_keywords (keyword_name);
CREATE INDEX IF NOT EXISTS idx_movie_cast_person_name ON movie_cast (person_name);
CREATE INDEX IF NOT EXISTS idx_movie_crew_person_name ON movie_crew (person_name);
CREATE INDEX IF NOT EXISTS idx_movie_ratings_stats_rating_average ON movie_ratings_stats (rating_average);
CREATE INDEX IF NOT EXISTS idx_sessions_status_created_at ON sessions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_session_preferences_session_id ON session_preferences (session_id);
CREATE INDEX IF NOT EXISTS idx_session_movie_feedback_session_id ON session_movie_feedback (session_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_events_session_id ON recommendation_events (session_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_event_id ON recommendation_feedback (recommendation_event_id);
