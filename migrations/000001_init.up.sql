CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sections (
    class_nbr INT PRIMARY KEY,
    subject TEXT NOT NULL,
    catalog_nbr TEXT NOT NULL,
    class_section TEXT NOT NULL,
    descr TEXT,
    term TEXT NOT NULL,
    last_enrollment_avail INT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE watches (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    class_nbr INT REFERENCES sections(class_nbr),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, class_nbr)
);
