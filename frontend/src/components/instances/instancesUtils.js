export const STATE_FILTERS = ['All', 'Running', 'Stopped', 'Suspended']

const ADJECTIVES = ['happy', 'calm', 'bold', 'bright', 'crisp', 'fancy', 'golden', 'kind', 'lush', 'mild', 'neat', 'proud', 'quick', 'sharp', 'sleek', 'smart', 'smooth', 'sonic', 'sunny', 'swift', 'vivid', 'warm', 'witty', 'brave', 'cool', 'deep', 'gentle', 'grand', 'jolly', 'keen', 'noble', 'plain', 'rapid', 'rich', 'serene', 'tender', 'wild', 'wise', 'zesty', 'fresh', 'clever']
const NOUNS      = ['shark', 'flower', 'tiger', 'panda', 'eagle', 'wolf', 'fox', 'lion', 'otter', 'robin', 'crane', 'raven', 'cobra', 'gecko', 'koala', 'lemur', 'moose', 'zebra', 'ferret', 'jaguar', 'narwhal', 'osprey', 'parrot', 'rabbit', 'salmon', 'toucan', 'walrus', 'dingo', 'marten', 'quail', 'lynx', 'bison', 'finch', 'heron', 'viper']
// Reserved for future use
// const HEROES = ['iron-man', 'thor', 'hulk', 'captain-america', 'black-widow', 'hawkeye', 'spider-man', 'black-panther', 'doctor-strange', 'scarlet-witch', 'vision', 'ant-man', 'wasp', 'falcon', 'war-machine', 'winter-soldier', 'rocket', 'groot', 'gamora', 'star-lord', 'nebula', 'drax', 'mantis', 'shang-chi', 'ms-marvel', 'moon-knight', 'she-hulk', 'deadpool', 'wolverine', 'cyclops', 'storm', 'rogue', 'nightcrawler', 'magneto', 'professor-x', 'daredevil', 'jessica-jones', 'luke-cage', 'punisher', 'ghost-rider', 'blade', 'nova', 'superman', 'batman', 'wonder-woman', 'flash', 'aquaman', 'green-lantern', 'cyborg', 'shazam', 'green-arrow', 'black-canary', 'nightwing', 'robin', 'catwoman', 'harley-quinn', 'zatanna', 'constantine', 'swamp-thing']
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
export function randomSnapshotName(instanceName) { return `${instanceName}-${pick(ADJECTIVES)}-${pick(NOUNS)}` }

export function fmtResource(bytes) {
  if (!bytes) return '—'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

// Returns null for falsy bytes — used where items are filtered with .filter(Boolean)
export function fmtNullable(bytes) {
  if (!bytes) return null
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

// Invalidate all instance-related queries after any mutating action
export function invalidateInstanceQueries(qc) {
  qc.invalidateQueries({ queryKey: ['instances'] })
  qc.invalidateQueries({ queryKey: ['stats'] })
  qc.invalidateQueries({ queryKey: ['activity'] })
}

export function sortValue(inst, key) {
  if (key === 'name') return inst.name ?? ''
  if (key === 'state') return inst.state ?? ''
  if (key === 'ipv4') return inst.ipv4?.[0] ?? ''
  if (key === 'image') return inst.image ?? ''
  if (key === 'cpus') return inst.cpus ?? 0
  if (key === 'memory') return inst.memory?.total ?? 0
  if (key === 'disk') return inst.disk?.total ?? 0
  if (key === 'usage') {
    const ramTotal = Number(inst.memory?.total) || 0
    const ramUsed = Number(inst.memory?.used) || 0
    const diskTotal = Number(inst.disk?.total) || 0
    const diskUsed = Number(inst.disk?.used) || 0
    const values = []
    if (ramTotal > 0) values.push((ramUsed / ramTotal) * 100)
    if (diskTotal > 0) values.push((diskUsed / diskTotal) * 100)
    if (!values.length) return 0
    return values.reduce((sum, v) => sum + v, 0) / values.length
  }
  return ''
}

export function matchInstance(inst, query) {
  if (!query.trim()) return true
  const low = query.toLowerCase()
  return (
    inst.name?.toLowerCase().includes(low) ||
    inst.state?.toLowerCase().includes(low) ||
    (inst.ipv4 || []).some(ip => ip.toLowerCase().includes(low)) ||
    (inst.image || '').toLowerCase().includes(low) ||
    String(inst.cpus ?? '').includes(low)
  )
}

export function filterInstances(instances, { stateFilter = 'All', imageFilter = 'All', query = '' }) {
  return instances
    .filter((item) => stateFilter === 'All' || item.state === stateFilter)
    .filter((item) => imageFilter === 'All' || (item.image || '—') === imageFilter)
    .filter((item) => matchInstance(item, query))
}
