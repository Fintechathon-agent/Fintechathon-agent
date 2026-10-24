'use strict';
const {validateConfig}=require('../conversation-20261024/vendor/provider/local-review.js');
try{validateConfig(process.env);process.stdout.write(JSON.stringify({configured:true,model:process.env.MODEL_NAME,provider:'aliyun_bailian'}));}
catch{process.stdout.write(JSON.stringify({configured:false,model:null,provider:'aliyun_bailian'}));}
