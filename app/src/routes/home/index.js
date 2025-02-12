"use strict";

import express from "express";
import multer from "multer"; // multer 모듈 임포트
import ctrl from "./home.ctrl.js";

const router = express.Router(); 

// multer 설정 (임시 저장: uploads/ 폴더)
const upload = multer({ dest: 'uploads/' });

router.get("/", ctrl.output.home);
router.get("/login", ctrl.output.login);
router.get("/register", ctrl.output.register);

router.post("/login", ctrl.process.login);
router.post("/register", ctrl.process.register);
router.post("/ChildhoodFriend", ctrl.process.childhoodfriend);
router.post("/GetBirth", ctrl.process.getbirth);

// 파일 업로드 요청에 multer 미들웨어 적용 (필드 이름 "file"이어야 함)
router.post("/upload_image", upload.single("file"), ctrl.process.upload_image);

export default router;
