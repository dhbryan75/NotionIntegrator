# NotionIntegrator
MetaDB에 DB 별로 흩어진 Task들을 통합하여 구글 캘린더에 자동으로 업로드하는 봇입니다.

# Usage
1. .env.sample을 복사하여 .env 파일을 만들고 노션 API key 및 MetaDB의 databaseId를 추가해야합니다.
1. google calendar 접근권한을 위해 credentials.json파일이 프로젝트 디렉토리에 필요합니다.
1. `crontab -e`으로 5분마다 실행되도록 크론탭을 설정해야 합니다.
`*/5 * * * * node ~/NotionIntegrator/index.js`