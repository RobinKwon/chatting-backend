"use strict";

import "dotenv/config"; // ESM 방식으로 dotenv 로드
import express from "express";
import serverless from "serverless-http";
import cors from "cors";
import home from "./src/routes/home/index.js"; // 확장자 `.js` 필수

const app = express();

// CORS 설정
// let corsOptions = {
//     origin: 'https://childhoodfriend.pages.dev',
//     credentials: true
// }
// app.use(cors(corsOptions));

// 250127_1210: all received
app.use(cors());

// app.use(cors({
//     origin: 'http://localhost:3000', // 실제 프론트엔드 서버 주소
//     credentials: true
// }));

// Express 미들웨어 설정
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// 라우터 적용
app.use("/", home);

export default app; // ✅ ESM 방식으로 내보내기
