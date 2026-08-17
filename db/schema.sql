# Database schema for Nexis AI

-- Create a simple table to store voicemail processing state
CREATE TABLE IF NOT EXISTS voicemails (
  id SERIAL PRIMARY KEY,
  recording_sid TEXT,
  s3_key TEXT,
  s3_url TEXT,
  from_number TEXT,
  status TEXT DEFAULT 'pending',
  transcript TEXT,
  reply_text TEXT,
  reply_s3_key TEXT,
  reply_s3_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
