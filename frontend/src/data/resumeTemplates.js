export const RESUME_TEMPLATES = [
  {
    id: 'java-backend',
    label: 'Java Backend Engineer',
    description: 'Senior Java backend — Spring Boot, Kafka, Redis, microservices. ATS-optimised with strong action verbs.',
    icon: '☕',
    template: `[FULL NAME]
[City, State] | [phone] | [email] | linkedin.com/in/[handle] | github.com/[handle]

PROFESSIONAL SUMMARY
Senior Java Backend Engineer with 4+ years of experience designing and delivering high-throughput, fault-tolerant microservices using Spring Boot, Apache Kafka, and Redis. Adept at event-driven architecture, REST/gRPC APIs, and cloud-native deployments on AWS. Proven track record of reducing API latency and improving system reliability at scale.

TECHNICAL SKILLS
Languages        : Java 17/21, SQL, Python (scripting)
Frameworks       : Spring Boot, Spring MVC, Spring Security, Spring Data JPA, Hibernate
Messaging        : Apache Kafka, RabbitMQ
Databases        : PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch
Cloud & DevOps   : AWS (EC2, S3, RDS, EKS, Lambda), Docker, Kubernetes, Jenkins, GitHub Actions
Patterns         : Microservices, Event-Driven Architecture, CQRS, Saga, REST, gRPC
Testing          : JUnit 5, Mockito, TestContainers, REST Assured
Tools            : Git, Maven, Gradle, SonarQube, Prometheus, Grafana, ELK Stack

PROFESSIONAL EXPERIENCE

Senior Software Engineer | [Company Name] | [City] | [Start Date] – Present
• Architected event-driven order-processing pipeline on Apache Kafka handling 2M+ messages/day with zero message loss.
• Redesigned Redis caching strategy for product catalog API, reducing P99 latency from 340 ms to 85 ms (75% improvement).
• Refactored monolithic checkout service into 5 Spring Boot microservices, enabling independent deployments and cutting release cycle from 2 weeks to 2 days.
• Led migration of on-premise databases to AWS RDS with zero-downtime blue-green deployment; reduced infra cost by 30%.
• Implemented distributed tracing with Jaeger and structured logging with ELK Stack, reducing MTTR from 2 h to 20 min.

Software Engineer | [Previous Company] | [City] | [Start Date] – [End Date]
• Built RESTful APIs consumed by 3 frontend teams serving 50 K+ daily active users using Spring Boot and PostgreSQL.
• Integrated third-party payment gateway (Razorpay/Stripe) with idempotency keys and retry logic, achieving 99.98% success rate.
• Authored comprehensive JUnit 5 + Mockito test suite raising code coverage from 42% to 87%.
• Containerised 8 legacy services using Docker and orchestrated with Kubernetes on AWS EKS; reduced deployment time by 60%.

EDUCATION
B.Tech / B.E. in Computer Science (or related) | [University Name] | [Year]

CERTIFICATIONS
• AWS Certified Solutions Architect – Associate (or equivalent)
• [Any other relevant certification]

PROJECTS
[Project Name] | github.com/[handle]/[repo]
• [2-3 bullet points describing the architecture, technologies used, and impact/scale]`,
  },
  {
    id: 'frontend',
    label: 'Frontend Developer',
    description: 'React/TypeScript focused, modern tooling, accessibility, performance-aware. ATS keywords included.',
    icon: '⚛️',
    template: `[FULL NAME]
[City, State] | [phone] | [email] | linkedin.com/in/[handle] | [portfolio-url]

PROFESSIONAL SUMMARY
Frontend Developer with 4+ years of experience building performant, accessible, and responsive web applications using React, TypeScript, and modern CSS frameworks. Skilled in state management, component library design, and performance optimisation (Core Web Vitals). Experienced with CI/CD pipelines and cross-functional collaboration with design and backend teams.

TECHNICAL SKILLS
Languages        : JavaScript (ES2022+), TypeScript, HTML5, CSS3
Frameworks/Libs  : React 18, Next.js, Vue.js, Redux Toolkit, React Query, Zustand
Styling          : Tailwind CSS, Material UI, Styled Components, Sass/SCSS
Testing          : Jest, React Testing Library, Cypress, Playwright, Storybook
Build Tools      : Vite, Webpack, Babel, ESLint, Prettier
Cloud/Deployment : Vercel, Netlify, AWS Amplify, GitHub Actions, Docker
Tools            : Git, Figma, Lighthouse, Datadog, Chrome DevTools

PROFESSIONAL EXPERIENCE

Senior Frontend Engineer | [Company Name] | [City] | [Start Date] – Present
• Rebuilt customer-facing checkout flow in React + TypeScript, improving conversion rate by 18% and reducing bounce rate by 12%.
• Achieved Lighthouse performance score of 96 by implementing lazy loading, code splitting, and image optimisation with Next.js Image.
• Designed and published shared component library (30+ components) in Storybook; adopted by 4 product teams and cutting dev time by 25%.
• Migrated legacy class components to functional components with React hooks, reducing bundle size by 20% and improving maintainability.
• Integrated Cypress E2E tests into CI pipeline with 95% critical-path coverage, eliminating regression escapes to production.

Frontend Developer | [Previous Company] | [City] | [Start Date] – [End Date]
• Built interactive data-visualisation dashboard (React + D3.js) rendering 100K+ data points with virtualised rendering.
• Collaborated with UX team to implement WCAG 2.1 AA accessibility standards across core product pages.
• Reduced Time to First Contentful Paint from 3.8 s to 1.4 s by adopting server-side rendering with Next.js.

EDUCATION
B.Tech / B.E. in Computer Science | [University Name] | [Year]

PROJECTS
[Project Name] | [live-url] | github.com/[handle]/[repo]
• Built with React + TypeScript + [tech]; [key feature]; [impact/metric]`,
  },
  {
    id: 'fullstack',
    label: 'Full Stack Developer',
    description: 'MERN/Java+React stack, end-to-end ownership. Good for startups and product companies.',
    icon: '🔁',
    template: `[FULL NAME]
[City, State] | [phone] | [email] | linkedin.com/in/[handle] | github.com/[handle]

PROFESSIONAL SUMMARY
Full Stack Developer with 4+ years of experience owning product features end-to-end — from React frontend to Node.js/Java backend and cloud deployment. Proficient in designing RESTful and GraphQL APIs, building scalable databases, and shipping to production via CI/CD pipelines. Thrive in fast-paced startup and product environments where breadth and speed matter.

TECHNICAL SKILLS
Frontend         : React 18, Next.js, TypeScript, Tailwind CSS, Redux, React Query
Backend          : Node.js, Express, Java, Spring Boot, GraphQL, REST APIs
Databases        : PostgreSQL, MongoDB, Redis, MySQL, Prisma, Mongoose
Cloud & DevOps   : AWS (EC2, S3, RDS, Lambda), Docker, Kubernetes, GitHub Actions, Vercel
Testing          : Jest, React Testing Library, Supertest, Cypress, JUnit 5
Tools            : Git, Figma, Postman, Stripe API, Twilio, SendGrid

PROFESSIONAL EXPERIENCE

Full Stack Engineer | [Company Name] | [City] | [Start Date] – Present
• Designed and shipped end-to-end SaaS onboarding flow (React + Node.js + PostgreSQL) reducing onboarding time from 15 min to 4 min.
• Built real-time notification system using WebSockets (Socket.IO) and Redis pub/sub serving 10 K+ concurrent users.
• Integrated Stripe payment API with webhook handling, subscription management, and automatic retry logic; 99.97% uptime.
• Implemented JWT + OAuth 2.0 authentication with Google SSO across React frontend and Node.js backend.
• Deployed multi-service architecture on AWS ECS with auto-scaling; reduced infrastructure cost by 35%.

Full Stack Developer | [Previous Company] | [City] | [Start Date] – [End Date]
• Built admin dashboard (React + Express + MongoDB) aggregating analytics for 200+ enterprise clients.
• Authored GraphQL API replacing 12 REST endpoints, cutting frontend data-fetching code by 40%.

EDUCATION
B.Tech / B.E. in Computer Science | [University Name] | [Year]

PROJECTS
[Project Name] | [live-url] | github.com/[handle]/[repo]
• [Describe stack, key feature, scale/impact in 2-3 bullets]`,
  },
  {
    id: 'devops',
    label: 'DevOps / Cloud Engineer',
    description: 'AWS/GCP, Kubernetes, Terraform, CI/CD, SRE-style. Strong ATS keyword density for cloud roles.',
    icon: '☁️',
    template: `[FULL NAME]
[City, State] | [phone] | [email] | linkedin.com/in/[handle] | github.com/[handle]

PROFESSIONAL SUMMARY
DevOps / Cloud Engineer with 4+ years of experience building and operating large-scale cloud infrastructure on AWS and GCP. Expert in Kubernetes orchestration, Infrastructure as Code (Terraform, Ansible), and CI/CD automation. Passionate about platform reliability, developer experience, and cost optimisation — achieved 99.99% SLA across production systems.

TECHNICAL SKILLS
Cloud Platforms  : AWS (EKS, EC2, RDS, S3, Lambda, IAM, CloudWatch), GCP, Azure
IaC & Config     : Terraform, Ansible, Pulumi, Helm, CloudFormation
Containers       : Docker, Kubernetes, Istio, containerd, Helm Charts
CI/CD            : Jenkins, GitHub Actions, GitLab CI, ArgoCD, CircleCI
Monitoring       : Prometheus, Grafana, ELK Stack, Datadog, PagerDuty, Jaeger
Scripting        : Bash, Python, Go, PowerShell
Security         : Vault, AWS IAM, RBAC, Network Policies, Trivy, Falco

PROFESSIONAL EXPERIENCE

Senior DevOps Engineer | [Company Name] | [City] | [Start Date] – Present
• Designed and maintained multi-cluster Kubernetes (EKS) platform supporting 50+ microservices and 200+ daily deployments.
• Reduced cloud infrastructure cost by 40% by right-sizing EC2 instances, adopting Spot instances, and implementing autoscaling policies.
• Implemented GitOps workflow using ArgoCD + GitHub Actions, cutting release lead time from 4 hours to 15 minutes.
• Authored Terraform modules for VPC, EKS, RDS, and S3 across 3 AWS accounts with 100% infrastructure-as-code coverage.
• Built observability stack (Prometheus + Grafana + ELK) with SLO-based alerting; reduced mean time to detect (MTTD) by 70%.

DevOps Engineer | [Previous Company] | [City] | [Start Date] – [End Date]
• Migrated CI/CD from manual scripts to Jenkins pipelines; automated builds and deployments for 30+ services.
• Containerised 15 legacy applications with Docker and onboarded them to Kubernetes, improving resource utilisation by 50%.
• Implemented Vault for secrets management, eliminating hard-coded credentials across all repositories.

EDUCATION
B.Tech / B.E. in Computer Science | [University Name] | [Year]

CERTIFICATIONS
• AWS Certified DevOps Engineer – Professional
• Certified Kubernetes Administrator (CKA)
• [Additional relevant certification]`,
  },
  {
    id: 'data-engineer',
    label: 'Data Engineer',
    description: 'Spark, Kafka, Airflow, Snowflake/BigQuery pipelines. ATS-optimised for data engineering roles.',
    icon: '📊',
    template: `[FULL NAME]
[City, State] | [phone] | [email] | linkedin.com/in/[handle] | github.com/[handle]

PROFESSIONAL SUMMARY
Data Engineer with 4+ years of experience building and maintaining large-scale data pipelines using Apache Spark, Kafka, and Airflow. Skilled in data warehouse design (Snowflake, BigQuery, Redshift), ETL/ELT pipeline development, and data quality frameworks. Delivered solutions processing 10 TB+ of daily data for business intelligence and ML teams.

TECHNICAL SKILLS
Languages        : Python, SQL, Scala, Java, PySpark
Pipeline Tools   : Apache Kafka, Apache Airflow, dbt, Prefect, Apache NiFi
Processing       : Apache Spark (PySpark), Apache Flink, AWS Glue, Databricks
Data Warehouses  : Snowflake, BigQuery, AWS Redshift, ClickHouse, Apache Hive
Storage/Formats  : AWS S3, HDFS, Delta Lake, Apache Iceberg, Parquet, Avro, ORC
Cloud Platforms  : AWS, GCP, Azure, AWS EMR, GCP Dataflow, Azure Synapse
Databases        : PostgreSQL, MongoDB, Cassandra, Elasticsearch, DynamoDB
Tools            : Docker, Kubernetes, Terraform, Jupyter, Git, Great Expectations

PROFESSIONAL EXPERIENCE

Senior Data Engineer | [Company Name] | [City] | [Start Date] – Present
• Built real-time data streaming pipeline on Apache Kafka + Spark Streaming ingesting 500 K events/minute with sub-second latency.
• Designed Snowflake data warehouse with star schema modelling; reduced analytical query time from 4 min to 8 sec (97% improvement).
• Developed 40+ dbt models and data quality checks (Great Expectations) ensuring 99.9% data accuracy for BI dashboards.
• Migrated batch ETL pipelines from legacy cron jobs to Apache Airflow DAGs, improving observability and reducing failures by 80%.
• Implemented Delta Lake on AWS S3 enabling ACID transactions and time-travel queries for 5 TB+ daily data lake.

Data Engineer | [Previous Company] | [City] | [Start Date] – [End Date]
• Built end-to-end ELT pipeline (Python + Airflow + BigQuery) processing 10 TB of clickstream data daily for ML feature generation.
• Reduced AWS infrastructure cost by 35% by optimising Spark jobs and adopting columnar Parquet storage on EMR.
• Onboarded 3 data sources from third-party APIs with schema validation, deduplication, and SLA monitoring.

EDUCATION
B.Tech / B.E. in Computer Science or related | [University Name] | [Year]

CERTIFICATIONS
• Google Professional Data Engineer
• [Databricks / Snowflake / AWS Data Analytics certification]

PROJECTS
[Project Name] | github.com/[handle]/[repo]
• [Describe pipeline, scale, technologies, and business impact]`,
  },
];
