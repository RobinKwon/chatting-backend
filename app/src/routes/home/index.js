"use strict";

import express from "express";
import ctrl from "./home.ctrl.js";

const router = express.Router(); 

router.get("/", ctrl.output.home);
router.get("/login", ctrl.output.login);
router.get("/register", ctrl.output.register);

router.post("/login", ctrl.process.login);
router.post("/register", ctrl.process.register);
router.post("/ChildhoodFriend", ctrl.process.childhoodfriend);
router.post("/GetBirth", ctrl.process.getbirth);

router.post("/Upload_image", ctrl.process.upload_image);

export default router; // ✅ ESM 방식으로 내보내기
