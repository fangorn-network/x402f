#!/bin/bash

# Start facilitator (in background)
npm run facilitator &
FACILITATOR_PID=$!

echo "Waiting for facilitator on port 30333..."

# Wait for liveness
while ! nc -z localhost 30333 2>/dev/null; do
    sleep 1
done

echo "Facilitator ready, starting server..."
npm run server

# Cleanup on exit
# trap "kill $FACILITATOR_PID 2>/dev/null" EXIT
