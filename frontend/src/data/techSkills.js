// Each entry: [canonicalName, ...lowercase aliases]
// The first element is what gets displayed; aliases are matched case-insensitively.
const SKILLS_DB = [
  // ── Languages ──────────────────────────────────────────────────
  ['Java'],
  ['Python', 'python3', 'py'],
  ['JavaScript', 'js', 'es6', 'es2015', 'ecmascript'],
  ['TypeScript', 'ts'],
  ['C++', 'cpp', 'c plus plus'],
  ['C#', 'csharp', 'c-sharp'],
  ['Go', 'golang'],
  ['Rust'],
  ['Kotlin'],
  ['Swift'],
  ['Scala'],
  ['Ruby'],
  ['PHP'],
  ['Bash', 'shell scripting', 'bash scripting', 'shell script'],
  ['PowerShell'],
  ['SQL'],
  ['PL/SQL', 'plsql'],
  ['R', 'r language', 'r programming'],

  // ── Frontend ────────────────────────────────────────────────────
  ['React', 'reactjs', 'react.js', 'react js'],
  ['Angular', 'angularjs', 'angular.js'],
  ['Vue.js', 'vuejs', 'vue js', 'vue'],
  ['Next.js', 'nextjs', 'next js'],
  ['Nuxt.js', 'nuxtjs'],
  ['Svelte'],
  ['jQuery'],
  ['HTML5', 'html'],
  ['CSS3', 'css'],
  ['Sass', 'scss'],
  ['Tailwind CSS', 'tailwind'],
  ['Bootstrap'],
  ['Material UI', 'material-ui', 'mui'],
  ['Redux'],
  ['webpack'],
  ['Vite'],
  ['GraphQL'],

  // ── Backend Frameworks ──────────────────────────────────────────
  ['Node.js', 'nodejs', 'node js'],
  ['Express.js', 'express', 'expressjs'],
  ['Spring Boot', 'spring-boot', 'springboot'],
  ['Spring Framework', 'spring mvc', 'spring core'],
  ['Spring Cloud'],
  ['Spring Security'],
  ['Hibernate', 'jpa', 'jakarta persistence'],
  ['Django'],
  ['Flask'],
  ['FastAPI'],
  ['Ruby on Rails', 'rails', 'ror'],
  ['Laravel'],
  ['ASP.NET', 'asp.net core', '.net core', 'dotnet'],
  ['NestJS', 'nestjs'],
  ['Micronaut'],
  ['Quarkus'],
  ['gRPC'],
  ['REST API', 'restful', 'restful api', 'rest services'],
  ['WebSocket', 'websockets'],
  ['OpenAPI', 'swagger'],

  // ── Databases ───────────────────────────────────────────────────
  ['MySQL'],
  ['PostgreSQL', 'postgres'],
  ['MongoDB', 'mongo'],
  ['Redis'],
  ['Cassandra', 'apache cassandra'],
  ['DynamoDB'],
  ['Oracle DB', 'oracle database', 'oracle'],
  ['SQL Server', 'mssql', 'microsoft sql server'],
  ['SQLite'],
  ['Elasticsearch', 'elastic search'],
  ['Neo4j'],
  ['InfluxDB'],
  ['Snowflake'],
  ['Redshift', 'amazon redshift'],
  ['BigQuery', 'google bigquery'],
  ['HBase'],
  ['Couchbase', 'couchdb'],

  // ── Cloud ───────────────────────────────────────────────────────
  ['AWS', 'amazon web services'],
  ['Google Cloud', 'gcp', 'google cloud platform'],
  ['Microsoft Azure', 'azure'],
  ['AWS Lambda', 'lambda'],
  ['Amazon EC2', 'ec2'],
  ['Amazon S3', 's3'],
  ['Amazon RDS', 'rds'],
  ['Amazon EKS', 'eks'],
  ['Amazon ECS', 'ecs'],
  ['CloudFormation', 'aws cloudformation'],
  ['Azure DevOps'],
  ['GKE', 'google kubernetes engine'],
  ['Cloud Functions'],
  ['Serverless', 'serverless framework'],

  // ── DevOps / Infrastructure ─────────────────────────────────────
  ['Docker', 'containerization', 'containers'],
  ['Kubernetes', 'k8s'],
  ['Terraform'],
  ['Ansible'],
  ['Jenkins'],
  ['GitLab CI', 'gitlab ci/cd', 'gitlab pipelines'],
  ['GitHub Actions'],
  ['CircleCI'],
  ['ArgoCD', 'argo cd'],
  ['Helm'],
  ['Prometheus'],
  ['Grafana'],
  ['Datadog'],
  ['New Relic'],
  ['Nginx'],
  ['CI/CD', 'continuous integration', 'continuous deployment', 'continuous delivery'],
  ['Linux', 'unix'],

  // ── Messaging / Streaming ───────────────────────────────────────
  ['Apache Kafka', 'kafka'],
  ['RabbitMQ'],
  ['ActiveMQ'],
  ['Amazon SQS', 'sqs'],
  ['Apache Pulsar', 'pulsar'],
  ['NATS'],
  ['Apache Flink', 'flink'],

  // ── Big Data ────────────────────────────────────────────────────
  ['Apache Spark', 'spark', 'pyspark'],
  ['Apache Hadoop', 'hadoop'],
  ['Apache Hive', 'hive'],
  ['Presto', 'trino'],
  ['Apache Airflow', 'airflow'],
  ['Databricks'],
  ['dbt', 'data build tool'],
  ['Apache Beam'],

  // ── ML / AI ─────────────────────────────────────────────────────
  ['TensorFlow'],
  ['PyTorch'],
  ['scikit-learn', 'sklearn'],
  ['Pandas'],
  ['NumPy'],
  ['Keras'],
  ['MLflow'],
  ['Hugging Face'],
  ['LangChain'],
  ['OpenAI API'],
  ['Machine Learning', 'ml'],
  ['Deep Learning'],
  ['NLP', 'natural language processing'],
  ['Computer Vision'],
  ['LLM', 'large language model'],
  ['RAG', 'retrieval augmented generation'],

  // ── Architecture / Patterns ─────────────────────────────────────
  ['Microservices', 'microservice architecture'],
  ['Event-Driven Architecture', 'event driven', 'event-driven'],
  ['Domain-Driven Design', 'ddd'],
  ['CQRS'],
  ['Event Sourcing'],
  ['SOA', 'service-oriented architecture'],
  ['Distributed Systems'],
  ['System Design'],
  ['High Availability', 'ha setup'],
  ['Load Balancing', 'load balancer'],
  ['API Gateway'],
  ['Service Mesh', 'istio'],
  ['Saga Pattern'],
  ['Design Patterns'],
  ['SOLID Principles', 'solid principles'],

  // ── Security ────────────────────────────────────────────────────
  ['OAuth2', 'oauth 2', 'oauth 2.0'],
  ['JWT', 'json web token'],
  ['SSO', 'single sign-on'],
  ['LDAP'],
  ['Keycloak'],
  ['OWASP'],

  // ── Testing ─────────────────────────────────────────────────────
  ['JUnit', 'junit5', 'junit 5'],
  ['Mockito'],
  ['Jest'],
  ['Cypress'],
  ['Selenium'],
  ['PyTest', 'pytest'],
  ['TestNG'],
  ['TDD', 'test driven development', 'test-driven'],
  ['BDD', 'behavior driven development'],
  ['Unit Testing', 'unit tests'],
  ['Integration Testing'],

  // ── Tools ───────────────────────────────────────────────────────
  ['Git', 'version control', 'git workflow'],
  ['Maven'],
  ['Gradle'],
  ['npm', 'node package manager'],
  ['Jira'],
  ['Confluence'],
  ['Postman'],
  ['IntelliJ IDEA', 'intellij'],
  ['SonarQube'],
  ['Splunk'],
  ['ELK Stack', 'elk', 'logstash', 'kibana'],

  // ── Methodologies ───────────────────────────────────────────────
  ['Agile'],
  ['Scrum'],
  ['Kanban'],
  ['DevOps'],
  ['SRE', 'site reliability engineering'],
  ['Clean Code'],
];

// Build alias → canonical map
export const SKILL_MAP = new Map();
for (const [canonical, ...aliases] of SKILLS_DB) {
  SKILL_MAP.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) {
    SKILL_MAP.set(alias.toLowerCase(), canonical);
  }
}

// Extract skills present in text, returning canonical names
export function extractSkills(text) {
  if (!text) return [];
  const found = new Set();

  for (const [alias, canonical] of SKILL_MAP.entries()) {
    // Escape special regex chars
    const escaped = alias.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&').replace(/\s+/g, '[\\s]+');
    try {
      // Match alias not preceded or followed by a plain letter/digit
      const re = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'gi');
      if (re.test(text)) found.add(canonical);
    } catch {
      if (text.toLowerCase().includes(alias)) found.add(canonical);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}
