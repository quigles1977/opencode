#!/bin/bash
set -e

echo "🏗️  Setting up bob test sandbox..."

# Create sandbox directory
SANDBOX="/tmp/bob-test-sandbox"
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

# Initialize git repo
git init
git config user.name "Test User"
git config user.email "test@example.com"

# Create realistic project structure
mkdir -p src tests docs config
mkdir -p src/components src/utils

# Create some test files
cat > README.md << 'EOF'
# Test Project

This is a safe sandbox for testing bob's tool prompts.
EOF

cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0",
  "scripts": {
    "test": "echo 'Running tests...' && exit 0",
    "build": "echo 'Building project...' && exit 0"
  }
}
EOF

cat > src/index.js << 'EOF'
// Main entry point
const config = require('./config');

function main() {
  console.log('Starting application...');
  console.log('Port:', config.port);
}

main();
EOF

cat > src/config.js << 'EOF'
module.exports = {
  port: 3000,
  timeout: 30,
  database: {
    host: 'localhost',
    port: 5432
  }
};
EOF

cat > src/utils/helpers.js << 'EOF'
// Utility functions
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
EOF

cat > tests/example.test.js << 'EOF'
const { add, multiply } = require('../src/utils/helpers');

test('add function', () => {
  expect(add(2, 3)).toBe(5);
});

test('multiply function', () => {
  expect(multiply(2, 3)).toBe(6);
});
EOF

cat > .gitignore << 'EOF'
node_modules/
dist/
.env
*.log
EOF

# Create a file with spaces in name for testing
mkdir -p "test with spaces"
echo "This file tests space handling" > "test with spaces/file.txt"

# Initial commit
git add .
git commit -m "Initial commit

This is the first commit in the test sandbox.

Co-Authored-By: Test <test@example.com>"

# Create a second commit
echo "// Updated config" >> src/config.js
git add src/config.js
git commit -m "Update config file"

# Create some uncommitted changes
echo "// Uncommitted change" >> src/index.js
echo "const newFeature = true;" >> src/utils/helpers.js

echo ""
echo "✅ Test sandbox created at: $SANDBOX"
echo ""
echo "📁 Structure:"
tree -L 2 "$SANDBOX" 2>/dev/null || find "$SANDBOX" -maxdepth 2 -type f | sed 's|/tmp/bob-test-sandbox/|  |'
echo ""
echo "📊 Git status:"
cd "$SANDBOX" && git status --short
echo ""
echo "To use this sandbox with bob:"
echo "  bob --project $SANDBOX"
echo ""
echo "To clean up:"
echo "  rm -rf $SANDBOX"
