import { getDatabase } from './database.js';

// All 18 YouTube channels from PRD
const sources = [
  // Del 1 - Nyheter & oppdateringer (5 kanaler)
  {
    name: 'AI Daily Brief',
    type: 'news',
    channel_url: 'https://www.youtube.com/@AIDailyBrief',
    channel_id: '', // Will be resolved
    weight: 1.0,
  },
  {
    name: 'Matthew Berman', 
    type: 'news',
    channel_url: 'https://www.youtube.com/@matthew_berman',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'MrEflow',
    type: 'news', 
    channel_url: 'https://www.youtube.com/@mreflow',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'The Next Wave Pod',
    type: 'news',
    channel_url: 'https://www.youtube.com/@TheNextWavePod/',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Last Week in AI',
    type: 'news',
    channel_url: 'https://www.youtube.com/@lastweekinai', 
    channel_id: '',
    weight: 1.0,
  },

  // Del 2 - Tema, debatter & perspektiver (7 kanaler)
  {
    name: 'All In Podcast',
    type: 'debate',
    channel_url: 'https://www.youtube.com/@allin',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Peter Diamandis',
    type: 'debate',
    channel_url: 'https://www.youtube.com/@peterdiamandis',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'TWIML AI',
    type: 'debate',
    channel_url: 'https://www.youtube.com/c/twimlai',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Eye on AI',
    type: 'debate',
    channel_url: 'https://www.youtube.com/channel/UC-o9u9QL4zXzBwjvT1gmzNg',
    channel_id: 'UC-o9u9QL4zXzBwjvT1gmzNg', // Direct channel ID
    weight: 1.0,
  },
  {
    name: 'No Priors Podcast',
    type: 'debate', 
    channel_url: 'https://www.youtube.com/@NoPriorsPodcast',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Cognitive Revolution',
    type: 'debate',
    channel_url: 'https://www.youtube.com/@CognitiveRevolutionPodcast', 
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Superhuman AI',
    type: 'debate',
    channel_url: 'https://www.youtube.com/@SuperhumanAIpodcast',
    channel_id: '',
    weight: 1.0,
  },

  // Del 3 - For utviklere (7 kanaler) 
  {
    name: 'Jordan Urbs AI',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@jordanurbsAI',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Riley Brown AI',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@rileybrownai',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Patrick Oakley Ellis',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@PatrickOakleyEllis',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'David Ondrej',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@DavidOndrej',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Cole Medin',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@ColeMedin',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'Indie Dev Dan',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@indydevdan',
    channel_id: '',
    weight: 1.0,
  },
  {
    name: 'AI Advantage',
    type: 'dev',
    channel_url: 'https://www.youtube.com/@aiadvantage',
    channel_id: '',
    weight: 1.0,
  },
];

async function seedSources() {
  console.log('Seeding sources table with YouTube channels...');
  
  const db = getDatabase();
  
  try {
    // Clear existing sources (for re-seeding)
    await db.run('DELETE FROM sources');
    console.log('Cleared existing sources');

    // Insert all sources
    for (const source of sources) {
      const result = await db.run(`
        INSERT INTO sources (name, type, channel_url, channel_id, weight, active)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        source.name,
        source.type,
        source.channel_url,
        source.channel_id || null, // Will be resolved later
        source.weight,
        1 // SQLite expects 1/0 for boolean, not true/false
      ]);

      console.log(`✓ Inserted: ${source.name} (${source.type})`);
    }

    // Verify seeding
    const count = await db.query('SELECT COUNT(*) as count FROM sources');
    console.log(`\nSeeded ${count[0]?.count || 0} sources successfully!`);

    // Show summary by type
    const summary = await db.query(`
      SELECT type, COUNT(*) as count, AVG(weight) as avg_weight
      FROM sources 
      WHERE active = 1
      GROUP BY type
      ORDER BY type
    `);

    console.log('\nSummary by type:');
    for (const row of summary) {
      console.log(`  ${row.type}: ${row.count} channels (avg weight: ${row.avg_weight?.toFixed(2)})`);
    }

  } catch (error) {
    console.error('Error seeding sources:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Export for use in other modules
export { sources };

// Run if called directly
if (require.main === module) {
  seedSources();
}