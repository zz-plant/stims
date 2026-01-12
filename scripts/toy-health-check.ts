import { playToy } from './play-toy.ts';
import toysData from '../assets/js/toys-data.js';

async function checkToys() {
  console.log('Starting toy health check...');
  
  const results: any[] = [];
  const failures: any[] = [];
  
  // Normalize toys data
  const toys = (Array.isArray(toysData) ? toysData : []) as { slug: string; title: string; }[];
  
  for (const toy of toys) {
    if (!toy.slug) continue;
    
    console.log(`Checking ${toy.title} (${toy.slug})...`);
    
    try {
      const result = await playToy({
        slug: toy.slug,
        duration: 2000,
        screenshot: true,
        outputDir: './health-check-screenshots'
      });
      
      results.push(result);
      
      if (!result.success || result.error) {
        console.error(`❌ ${toy.slug} failed:`, result.error);
        failures.push({ slug: toy.slug, error: result.error, consoleErrors: result.consoleErrors });
      } else {
        console.log(`✅ ${toy.slug} passed`);
      }
      
    } catch (e) {
      console.error(`❌ ${toy.slug} crashed:`, e);
      failures.push({ slug: toy.slug, error: String(e) });
    }
  }
  
  console.log('\n--- Health Check Module Summary ---');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${results.length - failures.length}`);
  console.log(`Failed: ${failures.length}`);
  
  if (failures.length > 0) {
    console.log('\nFailures:');
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (import.meta.main) {
  checkToys();
}
