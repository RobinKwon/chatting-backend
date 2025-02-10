"use strict";

import app from "../index.js"; // ESM 방식으로 변경
import logger from "../src/config/logger.js"; // 파일 확장자 `.js` 필수

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`${PORT} 포트에서 서버가 가동되었습니다.`);
});
