#!/bin/bash

# Start the facilitator app in the background
echo "Starting facilitator..."
npm run facilitator &
FACILITATOR_PID=$!

# Wait until the facilitator is running on port 30333
echo "Waiting for facilitator to be ready on port 30333..."
while ! nc -z localhost 30333 2>/dev/null; do
    # Check if the facilitator process is still running
    if ! kill -0 $FACILITATOR_PID 2>/dev/null; then
        echo "Facilitator process died unexpectedly"
        exit 1
    fi
    sleep 1
done

echo "Facilitator is ready on port 30333!"

# Start the server
echo "Starting server..."
npm run server