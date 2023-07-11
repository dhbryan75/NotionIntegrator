# NotionIntegrator
Notion to Google Calendar 1-way 연동 및 통합 봇\
MetaDB에 DB 별로 흩어진 Task들을 통합하여 구글 캘린더에 자동으로 업로드합니다.

# Usage
1. clone 또는 pull을 하면 `tsc` 명령어로 js파일을 컴파일 해야합니다.
1. ".env.sample"을 복사하여 ".env" 파일을 만들고 노션 API key 및 MetaDB의 databaseId를 추가해야합니다.
1. google calendar 접근권한을 위해 "credentials.json" 파일이 프로젝트 디렉토리에 필요합니다.
1. "token.json" 파일을 로컬 컴퓨터에서 생성하여 프로젝트 디렉토리로 복사해야합니다.
1. crontab이 실행할 "start.sh" 스크립트 파일을 작성해야합니다.
    ```
    cd ~/NotionIntegrator
    nohup node ~/NotionIntegrator/index.js >> ~/NotionIntegrator/result.out
    ```
1. `crontab -e`으로 5분마다 실행되도록 크론탭을 설정해야 합니다. \
    `1-56/5 * * * * ~/NotionIntegrator/start.sh`