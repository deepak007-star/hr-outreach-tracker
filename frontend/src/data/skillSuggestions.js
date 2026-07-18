const DOMAIN_SKILLS = {
  'java-backend': {
    label: 'Java Backend',
    core:    ['Java', 'Spring Boot', 'Spring MVC', 'Spring Security', 'Hibernate', 'JPA', 'Maven', 'Gradle'],
    messaging: ['Apache Kafka', 'RabbitMQ', 'ActiveMQ', 'AWS SQS'],
    databases: ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB'],
    cloud:   ['AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform'],
    testing: ['JUnit 5', 'Mockito', 'TestContainers', 'REST Assured', 'Postman'],
    patterns: ['Microservices', 'REST API', 'gRPC', 'Event-Driven Architecture', 'CQRS', 'Saga Pattern'],
    tools:   ['Git', 'Jenkins', 'GitHub Actions', 'SonarQube', 'Grafana', 'Prometheus', 'ELK Stack'],
    bonus:   ['Reactive Programming', 'WebFlux', 'Quarkus', 'Micronaut', 'JWT', 'OAuth 2.0'],
  },
  'frontend': {
    label: 'Frontend Developer',
    core:    ['JavaScript', 'TypeScript', 'HTML5', 'CSS3', 'React', 'Vue.js', 'Angular'],
    state:   ['Redux', 'Zustand', 'Pinia', 'Context API', 'React Query', 'SWR'],
    styling: ['Tailwind CSS', 'Material UI', 'Styled Components', 'Sass/SCSS', 'Ant Design'],
    testing: ['Jest', 'React Testing Library', 'Cypress', 'Playwright', 'Vitest'],
    build:   ['Vite', 'Webpack', 'Rollup', 'Babel', 'ESLint', 'Prettier'],
    cloud:   ['Vercel', 'Netlify', 'AWS Amplify', 'GitHub Pages'],
    tools:   ['Git', 'Figma', 'Storybook', 'Chromatic', 'Lighthouse'],
    bonus:   ['Next.js', 'Nuxt.js', 'Remix', 'Web Accessibility (WCAG)', 'WebSockets', 'PWA'],
  },
  'fullstack': {
    label: 'Full Stack Developer',
    frontend: ['React', 'TypeScript', 'Next.js', 'Tailwind CSS', 'Redux', 'REST APIs', 'GraphQL'],
    backend:  ['Node.js', 'Express', 'Python', 'Django', 'FastAPI', 'Java', 'Spring Boot'],
    databases: ['PostgreSQL', 'MongoDB', 'MySQL', 'Redis', 'Prisma', 'Mongoose'],
    cloud:   ['AWS', 'GCP', 'Docker', 'Kubernetes', 'CI/CD', 'GitHub Actions'],
    testing: ['Jest', 'Pytest', 'Cypress', 'Postman', 'Supertest'],
    tools:   ['Git', 'Figma', 'Linux', 'Nginx', 'WebSockets', 'JWT', 'OAuth 2.0'],
  },
  'devops': {
    label: 'DevOps / Cloud Engineer',
    cloud:   ['AWS', 'GCP', 'Azure', 'AWS EC2', 'AWS EKS', 'AWS Lambda', 'AWS RDS'],
    iac:     ['Terraform', 'Ansible', 'Pulumi', 'CloudFormation', 'Helm'],
    containers: ['Docker', 'Kubernetes', 'Helm', 'Istio', 'containerd', 'Docker Compose'],
    cicd:    ['Jenkins', 'GitHub Actions', 'GitLab CI', 'ArgoCD', 'Spinnaker', 'CircleCI'],
    monitoring: ['Prometheus', 'Grafana', 'ELK Stack', 'Datadog', 'PagerDuty', 'Jaeger'],
    scripting: ['Bash', 'Python', 'Go', 'PowerShell'],
    security: ['Vault', 'AWS IAM', 'RBAC', 'Network Policies', 'SAST/DAST', 'Trivy'],
  },
  'data-engineer': {
    label: 'Data Engineer',
    core:    ['Python', 'SQL', 'PySpark', 'Apache Spark', 'Scala', 'Java'],
    pipelines: ['Apache Kafka', 'Apache Airflow', 'dbt', 'Prefect', 'Luigi', 'Apache NiFi'],
    warehouses: ['Snowflake', 'BigQuery', 'Redshift', 'Databricks', 'ClickHouse', 'Apache Hive'],
    storage: ['AWS S3', 'HDFS', 'Delta Lake', 'Apache Iceberg', 'Parquet', 'Avro'],
    cloud:   ['AWS', 'GCP', 'Azure', 'AWS Glue', 'AWS EMR', 'GCP Dataflow'],
    databases: ['PostgreSQL', 'MongoDB', 'Cassandra', 'Elasticsearch', 'DynamoDB'],
    tools:   ['Git', 'Docker', 'Kubernetes', 'Terraform', 'Jupyter', 'Apache Superset'],
    bonus:   ['Machine Learning', 'MLOps', 'Feature Store', 'Data Quality', 'Great Expectations'],
  },
};

const DOMAIN_KEYWORDS = {
  'java-backend': ['java', 'spring', 'jvm', 'hibernate', 'maven', 'gradle', 'backend developer', 'server side'],
  'frontend':     ['react', 'vue', 'angular', 'frontend', 'ui developer', 'web developer', 'javascript developer'],
  'fullstack':    ['fullstack', 'full stack', 'full-stack', 'mern', 'mean', 'lamp'],
  'devops':       ['devops', 'cloud engineer', 'platform engineer', 'sre', 'infrastructure', 'kubernetes', 'terraform'],
  'data-engineer':['data engineer', 'etl', 'spark', 'airflow', 'data pipeline', 'big data', 'warehouse'],
};

export function detectDomain(title = '', skills = []) {
  const text = `${title} ${skills.join(' ')}`.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return domain;
  }
  return 'java-backend'; // default for Vishal's profile
}

export function getSuggestedSkills(title = '', existingSkills = []) {
  const domain = detectDomain(title, existingSkills);
  const domainData = DOMAIN_SKILLS[domain];
  if (!domainData) return [];

  const existing = new Set(existingSkills.map(s => s.toLowerCase()));
  const suggestions = [];

  for (const [category, skills] of Object.entries(domainData)) {
    if (category === 'label') continue;
    for (const skill of skills) {
      if (!existing.has(skill.toLowerCase())) {
        suggestions.push({ skill, category, domain: domainData.label });
      }
    }
  }

  // Sort: core first, then by category order
  const CATEGORY_PRIORITY = ['core', 'frontend', 'backend', 'patterns', 'messaging', 'databases', 'cloud', 'cicd', 'containers', 'iac', 'pipelines', 'warehouses', 'storage', 'testing', 'tools', 'scripting', 'monitoring', 'security', 'state', 'styling', 'build', 'bonus'];
  suggestions.sort((a, b) => {
    const ai = CATEGORY_PRIORITY.indexOf(a.category);
    const bi = CATEGORY_PRIORITY.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return suggestions.slice(0, 40);
}

export { DOMAIN_SKILLS };
