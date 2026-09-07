CREATE TABLE verification_tokens (
    token TEXT PRIMARY KEY,
    user_id INT REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);