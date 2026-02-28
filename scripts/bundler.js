const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node bundler.js <src_directory> <output_file> [--strip]');
  console.error('Example: node bundler.js src output/bundled.as');
  console.error('Example: node bundler.js src output/bundled.as --strip');
  process.exit(1);
}

const strip_comments = args.includes('--strip');
const non_flag_args = args.filter(arg => arg !== '--strip');

if (non_flag_args.length < 2) {
  console.error('Usage: node bundler.js <src_directory> <output_file> [--strip]');
  console.error('Example: node bundler.js src output/bundled.as --strip');
  process.exit(1);
}

const src_dir = path.resolve(non_flag_args[0]);
const output_file = path.resolve(non_flag_args[1]);

const visited = new Set();
const output = [];
const processing = new Set();
const file_order = [];

function get_all_as_files(dir) {
  const files = [];
  
  function scan(current_dir) {
    const entries = fs.readdirSync(current_dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const full_path = path.join(current_dir, entry.name);
      
      if (entry.isDirectory()) {
        scan(full_path);
      } else if (entry.isFile() && entry.name.endsWith('.as')) {
        files.push(full_path);
      }
    }
  }
  
  scan(dir);
  return files;
}

function parse_includes(content, file_path) {
  const include_regex = /#include\s+"([^"]+)"/g;
  const includes = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/#include\s+"([^"]+)"/);
    if (match) {
      includes.push({ path: match[1], line: i + 1 });
    }
  }
  return includes;
}

function strip_comments_from_code(content) {
  let result = '';
  let in_string = false;
  let string_char = '';
  let i = 0;
  
  while (i < content.length) {
    if (!in_string) {
      // Check for single-line comment
      if (i < content.length - 1 && content[i] === '/' && content[i + 1] === '/') {
        // Skip to end of line, but preserve the newline if it exists
        while (i < content.length && content[i] !== '\n') {
          i++;
        }
        if (i < content.length && content[i] === '\n') {
          result += content[i];
          i++;
        }
        continue;
      }
      
      // Check for multi-line comment
      if (i < content.length - 1 && content[i] === '/' && content[i + 1] === '*') {
        i += 2;
        // Skip until closing */
        while (i < content.length - 1) {
          if (content[i] === '*' && content[i + 1] === '/') {
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }
      
      // Check for string start
      if (content[i] === '"' || content[i] === "'") {
        in_string = true;
        string_char = content[i];
        result += content[i];
        i++;
        continue;
      }
    } else {
      // Inside string
      if (content[i] === string_char) {
        // Check if it's escaped
        if (i > 0 && content[i - 1] !== '\\') {
          in_string = false;
          string_char = '';
        }
        result += content[i];
        i++;
        continue;
      }
    }
    
    result += content[i];
    i++;
  }
  
  return result;
}

function normalize_whitespace(content) {
  // Split into lines
  const lines = content.split('\n');
  const normalized = [];
  let consecutive_blanks = 0;
  
  for (let i = 0; i < lines.length; i++) {
    // Trim trailing whitespace from each line
    const trimmed = lines[i].replace(/\s+$/, '');
    
    // Check if line is blank (after trimming trailing whitespace)
    const is_blank = trimmed.length === 0;
    
    if (is_blank) {
      consecutive_blanks++;
      // Allow max 1 blank line (2 consecutive blanks = 1 blank line separator)
      if (consecutive_blanks <= 2) {
        normalized.push('');
      }
    } else {
      consecutive_blanks = 0;
      normalized.push(trimmed);
    }
  }
  
  // Remove leading and trailing blank lines
  while (normalized.length > 0 && normalized[0] === '') {
    normalized.shift();
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }
  
  return normalized.join('\n');
}

function process_file(file_path, include_chain = []) {
  const normalized = path.resolve(file_path);
  
  if (visited.has(normalized)) return;
  
  if (processing.has(normalized)) {
    const chain = [...include_chain, normalized].map(p => path.relative(process.cwd(), p)).join('\n  -> ');
    console.error(`\nError: Circular dependency detected:`);
    console.error(`  -> ${chain}`);
    process.exit(1);
  }

  if (!fs.existsSync(normalized)) {
    console.error(`\nError: File not found: "${normalized}"`);
    if (include_chain.length > 0) {
      const parent = include_chain[include_chain.length - 1];
      console.error(`Referenced from: "${path.relative(process.cwd(), parent)}"`);
    }
    process.exit(1);
  }

  processing.add(normalized);
  visited.add(normalized);

  let content;
  try {
    content = fs.readFileSync(normalized, 'utf8');
  } catch (err) {
    console.error(`\nError: Unable to read file: "${normalized}"`);
    console.error(`Reason: ${err.message}`);
    process.exit(1);
  }

  const includes = parse_includes(content, normalized);
  const file_dir = path.dirname(normalized);

  for (const inc of includes) {
    const inc_path = path.resolve(file_dir, inc.path);
    try {
      process_file(inc_path, [...include_chain, normalized]);
    } catch (err) {
      console.error(`\nError processing include at line ${inc.line} in "${path.relative(process.cwd(), normalized)}"`);
      console.error(`Include: #include "${inc.path}"`);
      throw err;
    }
  }

  processing.delete(normalized);
  file_order.push(normalized);
}

try {
  console.log(`Scanning directory: ${path.relative(process.cwd(), src_dir)}`);
  
  const all_files = get_all_as_files(src_dir);
  console.log(`Found ${all_files.length} .as file(s)`);
  
  for (const file of all_files) {
    process_file(file);
  }
  
  for (const file of file_order) {
    let content = fs.readFileSync(file, 'utf8');
    // Remove include lines completely (including the entire line)
    const content_without_includes = content.replace(/#include\s+"[^"]+"\s*\n?/g, '');
    let processed_content = content_without_includes;
    
    if (strip_comments) {
      processed_content = strip_comments_from_code(processed_content);
    } else {
      // Keep file comment header when not stripping
      processed_content = `// File: ${path.relative(src_dir, file)}\n${processed_content}`;
    }
    
    // Normalize whitespace (remove excessive blank lines, trim trailing whitespace)
    processed_content = normalize_whitespace(processed_content);
    
    if (processed_content.length > 0) {
      output.push(processed_content);
    }
  }
  
  // Join files with single blank line separator
  const bundled = output.join('\n\n');
  
  // Final normalization pass to ensure clean output
  const final_bundled = normalize_whitespace(bundled);
  const out_dir = path.dirname(output_file);
  if (!fs.existsSync(out_dir)) {
    fs.mkdirSync(out_dir, { recursive: true });
  }
  fs.writeFileSync(output_file, final_bundled);
  
  console.log(`✓ Successfully bundled ${visited.size} file(s) in dependency order`);
  if (strip_comments) {
    console.log(`✓ Comments stripped from output`);
  }
  console.log(`Output: ${path.relative(process.cwd(), output_file)}`);
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') {
    console.error(`\nFatal error: ${err.message}`);
  }
  process.exit(1);
}