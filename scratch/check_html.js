import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';

const files = [
  'index.html',
  'ui-harness.html',
  'certify/index.html',
  'milkdrop/index.html',
  'performance/index.html',
  'public/test-audio-controls-harness.html'
];

function walk(node, cb) {
  cb(node);
  if (node.childNodes) {
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i], cb);
    }
  }
}

for (const file of files) {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${file}`);
    continue;
  }
  
  console.log(`\nAnalyzing ${file}...`);
  const html = fs.readFileSync(filePath, 'utf8');
  
  const window = new Window({ url: 'http://localhost/' });
  const document = window.document;
  document.write(html);
  
  const ids = new Set();
  const duplicates = [];
  const buttonsWithoutType = [];
  const unlabeled = [];
  const imgsWithoutAlt = [];
  
  walk(document.body, (node) => {
    // Check if it's an element node (nodeType === 1)
    if (node.nodeType !== 1) return;
    
    // Check duplicate ID
    const id = node.id;
    if (id) {
      if (ids.has(id)) {
        duplicates.push(id);
      }
      ids.add(id);
    }
    
    // Check button type
    if (node.tagName === 'BUTTON') {
      if (!node.getAttribute('type')) {
        buttonsWithoutType.push(node.outerHTML);
      }
    }
    
    // Check unlabeled inputs/selects/textareas
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) {
      if (node.getAttribute('type') !== 'hidden') {
        let hasLabel = false;
        if (id) {
          // Check for label with matching 'for' attribute
          let foundLabel = false;
          walk(document.body, (n) => {
            if (n.tagName === 'LABEL' && n.getAttribute('for') === id) {
              foundLabel = true;
            }
          });
          if (foundLabel) hasLabel = true;
        }
        
        // Check if wrapped in a label
        let current = node.parentNode;
        while (current) {
          if (current.tagName === 'LABEL') {
            hasLabel = true;
            break;
          }
          current = current.parentNode;
        }
        
        // Check aria-label or aria-labelledby
        if (node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')) {
          hasLabel = true;
        }
        
        if (!hasLabel) {
          unlabeled.push(node.outerHTML);
        }
      }
    }
    
    // Check img alt
    if (node.tagName === 'IMG') {
      if (!node.hasAttribute('alt')) {
        imgsWithoutAlt.push(node.outerHTML);
      }
    }
  });
  
  if (duplicates.length > 0) {
    console.log(`  [FAIL] Duplicate IDs found: ${duplicates.join(', ')}`);
  } else {
    console.log(`  [PASS] No duplicate IDs.`);
  }
  
  if (buttonsWithoutType.length > 0) {
    console.log(`  [FAIL] Buttons without 'type' attribute:\n    ${buttonsWithoutType.join('\n    ')}`);
  } else {
    console.log(`  [PASS] All buttons have 'type' attributes.`);
  }
  
  if (unlabeled.length > 0) {
    console.log(`  [FAIL] Unlabeled inputs/selects:\n    ${unlabeled.join('\n    ')}`);
  } else {
    console.log(`  [PASS] All inputs/selects are labeled.`);
  }
  
  if (imgsWithoutAlt.length > 0) {
    console.log(`  [FAIL] Images without 'alt' attribute:\n    ${imgsWithoutAlt.join('\n    ')}`);
  } else {
    console.log(`  [PASS] All images have 'alt' attributes.`);
  }
}
