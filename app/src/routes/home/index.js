"use strict";

import express from "express";
import ctrl from "./home.ctrl.js"; // 파일 확장자 `.js` 필수

const router = express.Router(); 

router.get("/", ctrl.output.home);
router.get("/login", ctrl.output.login);
router.get("/register", ctrl.output.register);

router.post("/login", ctrl.process.login);
router.post("/register", ctrl.process.register);
router.post("/ChildhoodFriend", ctrl.process.childhoodfriend);
router.post("/GetBirth", ctrl.process.getbirth);

export default router; // ✅ ESM 방식으로 내보내기
