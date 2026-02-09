import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
    'https://agkkvtfwqmzgbrqhvohs.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg4MjU3NzcsImV4cCI6MjA1NDQwMTc3N30.cNEhFMhQC8QOjROBkHeDdEJxME6KfWfHMOmfMNYG4WE'
);

export { supabase };
