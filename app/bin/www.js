"use strict";

import app from "../index.js"; // ESM 방식으로 변경
import http from 'http'; // http 모듈 import
import { setupWebSocket } from '../src/models/vchat.js'; // WebSocket 설정 함수 import
import logger from "../src/config/logger.js"; // 파일 확장자 `.js` 필수

const PORT = process.env.PORT || 3000;

// HTTP 서버 생성
const server = http.createServer(app);

// WebSocket 서버 설정
setupWebSocket(server);

// 서버 시작
server.listen(PORT, () => {
  logger.info(`${PORT} 포트에서 서버가 가동되었습니다.`);
});
