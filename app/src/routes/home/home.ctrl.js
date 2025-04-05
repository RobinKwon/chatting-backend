"use strict";

import S3_Bucket from "../../models/S3Bucket.js";
import logger from "../../config/logger.js";
import User from "../../models/User.js";
import Friend from "../../models/Friend.js";
import session from "../../models/session.js"; //250310_2326:session model import

const output = {
  home: (req, res) => {
    logger.info(`GET / 304 "홈 화면으로 이동"`);
    res.render("home/index");
  },

  login: (req, res) => {
    logger.info(`GET /login 304 "로그인 화면으로 이동"`);
    res.render("home/login");
  },

  register: (req, res) => {
    logger.info(`GET /register 304 "회원가입 화면으로 이동"`);
    res.render("home/register");
  },

  //250311_0625:vchat 연결 페이지 (예: vchat.html)
  vchat: (req, res) => {
    logger.info(`GET /vchat 304 "vchat 화면으로 이동"`);
    res.render("home/vchat");
  },
};

const process = {
  login: async (req, res) => {
    const user = new User(req.body);
    const response = await user.login();
    const url = {
      method: "POST",
      path: "/login",
      status: response.err ? 400 : 200,
    };
    log(response, url);
    return res.status(url.status).json(response);
  },

  register: async (req, res) => {
    const user = new User(req.body);
    const response = await user.register();
    const url = {
      method: "POST",
      path: "/register",
      status: response.err ? 409 : 201,
    };
    log(response, url);
    return res.status(url.status).json(response);
  },

  getbirth: async (req, res) => {
    const user = new User(req.body);
    const response = await user.getbirth();
    const url = {
      method: "POST",
      path: "/getbirth",
      status: response.err ? 400 : 200,
    };
    log(response, url);
    return res.status(url.status).json(response);
  },

  childhoodfriend: async (req, res) => {
    const friend = new Friend(req.body);
    const response = await friend.childhoodfriend();
    const url = {
      method: "POST",
      path: "/childhoodfriend",
      status: response.err ? 400 : 200,
    };
    log(response, url);
    return res.status(url.status).json(response);
  },

  upload_image: async (req, res) => {
    // multer가 multipart/form-data 요청을 파싱하면
    // req.body에는 text 필드들이, req.file에는 파일 정보가 채워집니다.
    // 따라서 두 객체를 합쳐 S3_Bucket 생성자에 전달합니다.
    const clientData = {
      id: req.body.id,
      file: req.file,
      // 프론트엔드에서 추가 데이터(userMessages 등)가 있다면 아래와 같이 처리할 수 있습니다.
      userMessages: req.body.userMessages ? JSON.parse(req.body.userMessages) : []
    };

    const s3_bucket = new S3_Bucket(clientData);
    const response = await s3_bucket.upload_image();
    const url = {
      method: "POST",
      path: "/upload_image",
      status: response.err ? 400 : 200,
    };
    log(response, url);
    return res.status(url.status).json(response);
  },

  //250310_2326:프론트엔드에서 세션 생성을 호출할 수 있도록 하는 엔드포인트
  createSession: async (req, res) => {
    try {
      // session.create는 Lambda 이벤트 객체 형태를 기대하므로, req.body를 문자열로 감싸 전달합니다.
      const event = { body: JSON.stringify(req.body) };
      const response = await session.create(event);
      res.status(response.statusCode)
          .set(response.headers)
          .json(JSON.parse(response.body));
    } catch (error) {
      console.error("Session creation error", error);
      res.status(500).json({ error: "Session creation error" });
    }
  },

  //250310_2326:프론트엔드에서 세션 종료를 호출할 수 있도록 하는 엔드포인트
  endSession: async (req, res) => {
    try {
      const event = { body: JSON.stringify(req.body) };
      const response = await session.end(event);
      res.status(response.statusCode)
          .set(response.headers)
          .json(JSON.parse(response.body));
    } catch (error) {
      console.error("Session end error", error);
      res.status(500).json({ error: "Session end error" });
    }
  },
};

export default { output, process };

const log = (response, url) => {
  if (response.err) {
    logger.error(
      `${url.method} ${url.path} ${url.status} Response: ${response.success} ${response.err}`
    );
  } else {
    logger.info(
      `${url.method} ${url.path} ${url.status} Response: ${response.success} ${
        response.message || ""
      }`
    );
  }
};
