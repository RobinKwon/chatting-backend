require('dotenv').config();
const express = require('express');
const serverless = require('serverless-http');
var cors = require('cors');
const app = express();
const home = require("./src/routes/home");

//CORS 이슈 해결
// let corsOptions = {
//     origin: 'https://childhoodfriend.pages.dev',
//     credentials: true
// }
// app.use(cors(corsOptions));

//250127_1210:all received
app.use(cors());
// app.use(cors({
//     origin: 'http://localhost:3000', // 실제 프론트엔드 서버 주소
//     credentials: true
// }));

//express를 쓸때 사용.
app.use(express.json())         // for parsing application/json
app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

app.use("/", home);

module.exports = app;

