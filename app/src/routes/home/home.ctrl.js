"use strict";

import logger from "../../config/logger.js";
import User from "../../models/User.js";
import Friend from "../../models/Friend.js";

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
    const s3_bucket = new S3_Bucket(req.body);
    const response = await s3_bucket.upload_image();
    const url = {
      method: "POST",
      path: "/upload_image",
      status: response.err ? 400 : 200,
    };
    log(response, url);
    return res.status(url.status).json(response);
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
