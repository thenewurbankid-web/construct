module.exports={forbidden:[
 {name:'page-to-workflow',from:{path:'features/.*/pages'},to:{path:'features/.*/workflows'},severity:'error'},
 {name:'page-to-service',from:{path:'features/.*/pages'},to:{path:'features/.*/services'},severity:'error'},
 {name:'page-to-domain',from:{path:'features/.*/pages'},to:{path:'features/.*/domain'},severity:'error'},
 {name:'component-to-app-logic',from:{path:'features/.*/components'},to:{path:'features/.*/(controllers|workflows|services|domain)'},severity:'error'},
 {name:'workflow-to-ui',from:{path:'features/.*/workflows'},to:{path:'(components|pages|controllers)'},severity:'error'},
 {name:'service-to-ui',from:{path:'features/.*/services'},to:{path:'(components|pages|controllers|workflows)'},severity:'error'}]};
